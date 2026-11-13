package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// searchTimeout bounds a whole-database scan so a broad search cannot pin a
// connection for the full operation timeout.
const (
	searchTimeout               = 30 * time.Second
	searchCollectionConcurrency = 4
)

type searchRequest struct {
	Term string `json:"term"`
	// Field restricts a value search to one field path (supports dots).
	Field string `json:"field"`
	// Mode is "value" (default) or "field" (search field names).
	Mode           string `json:"mode"`
	Limit          int64  `json:"limit"`
	MaxCollections int64  `json:"maxCollections"`
}

type searchCollectionResult struct {
	Collection string          `json:"collection"`
	Count      int64           `json:"count"`
	Sample     json.RawMessage `json:"sample"`
}

// searchMatchExpr builds the $expr that matches a document when any field name
// (mode "field") or any field value (mode "value") matches pattern.
func searchMatchExpr(mode, pattern string) bson.M {
	input := any("$$kv.k")
	if mode != "field" {
		input = bson.M{"$toString": "$$kv.v"}
	}
	return bson.M{
		"$expr": bson.M{
			"$gt": bson.A{
				bson.M{
					"$size": bson.M{
						"$filter": bson.M{
							"input": bson.M{"$objectToArray": "$$ROOT"},
							"as":    "kv",
							"cond": bson.M{
								"$regexMatch": bson.M{
									"input":   input,
									"regex":   pattern,
									"options": "i",
								},
							},
						},
					},
				},
				0,
			},
		},
	}
}

// searchDatabase looks for a term across the collections of a database. The
// number of collections is bounded, scans run with bounded concurrency, and the
// response reports whether the result is partial.
func (a *API) searchDatabase(w http.ResponseWriter, r *http.Request) {
	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req searchRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}
	term := strings.TrimSpace(req.Term)
	if term == "" {
		badRequest(w, errors.New("search term is required"))
		return
	}
	if len(term) < 2 {
		badRequest(w, errors.New("search term must be at least 2 characters"))
		return
	}
	mode := req.Mode
	if mode != "field" {
		mode = "value"
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 3
	}
	if limit > 20 {
		limit = 20
	}
	maxCollections := req.MaxCollections
	if maxCollections <= 0 {
		maxCollections = 100
	}
	if maxCollections > 500 {
		maxCollections = 500
	}
	pattern := regexp.QuoteMeta(term)

	started := time.Now()
	ctx, cancel := context.WithTimeout(r.Context(), searchTimeout)
	defer cancel()

	db := client.Database(chi.URLParam(r, "db"))
	allNames, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		a.dbErr(w, err)
		return
	}
	names := make([]string, 0, len(allNames))
	for _, name := range allNames {
		if !strings.HasPrefix(name, "system.") {
			names = append(names, name)
		}
	}
	totalCollections := len(names)
	truncated := false
	if int64(len(names)) > maxCollections {
		names = names[:maxCollections]
		truncated = true
	}

	// Each goroutine writes its own slot, so no mutex is needed for results.
	byIndex := make([]searchCollectionResult, len(names))
	matchesByIndex := make([]int64, len(names))
	var failed atomic.Int64
	sem := make(chan struct{}, searchCollectionConcurrency)
	var wg sync.WaitGroup
	scanned := 0
dispatch:
	for i, name := range names {
		if ctx.Err() != nil {
			break
		}
		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
			break dispatch
		}
		scanned++
		wg.Add(1)
		go func(index int, collection string) {
			defer wg.Done()
			defer func() { <-sem }()
			result, matches, err := a.searchCollection(ctx, db.Collection(collection), req.Field, mode, pattern, limit)
			if err != nil {
				failed.Add(1)
				return
			}
			if matches > 0 {
				result.Collection = collection
				byIndex[index] = result
				matchesByIndex[index] = matches
			}
		}(i, name)
	}
	wg.Wait()

	results := make([]searchCollectionResult, 0)
	for i := range byIndex {
		if matchesByIndex[i] > 0 {
			results = append(results, byIndex[i])
		}
	}
	timedOut := ctx.Err() != nil
	if scanned < len(names) {
		truncated = true
	}
	ok(w, map[string]any{
		"term":             term,
		"mode":             mode,
		"results":          results,
		"scanned":          scanned,
		"totalCollections": totalCollections,
		"truncated":        truncated,
		"timedOut":         timedOut,
		"failed":           failed.Load(),
		"durationMs":       float64(time.Since(started).Microseconds()) / 1000,
	})
}

// searchCollection returns the match count and a sample for a single collection.
// A $facet stage counts and samples in one scan instead of running the same
// match pipeline twice.
func (a *API) searchCollection(
	ctx context.Context,
	coll *mongo.Collection,
	field, mode, pattern string,
	limit int64,
) (searchCollectionResult, int64, error) {
	match := any(searchMatchExpr(mode, pattern))
	if mode == "value" && field != "" {
		// A field-restricted value search is a plain (index-friendly) regex.
		match = bson.M{field: bson.M{"$regex": pattern, "$options": "i"}}
	}
	return facetSearch(ctx, coll, match, limit)
}

type facetCount struct {
	Count int64 `bson:"count"`
}

func facetSearch(ctx context.Context, coll *mongo.Collection, match any, limit int64) (searchCollectionResult, int64, error) {
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: match}},
		{{Key: "$facet", Value: bson.D{
			{Key: "count", Value: mongo.Pipeline{{{Key: "$count", Value: "count"}}}},
			{Key: "sample", Value: mongo.Pipeline{{{Key: "$limit", Value: limit}}}},
		}}},
	}
	cursor, err := coll.Aggregate(ctx, pipeline)
	if err != nil {
		return searchCollectionResult{}, 0, err
	}
	defer cursor.Close(ctx)

	var rows []struct {
		Count  []facetCount `bson:"count"`
		Sample []bson.D     `bson:"sample"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return searchCollectionResult{}, 0, err
	}
	if len(rows) == 0 {
		return searchCollectionResult{}, 0, nil
	}
	count := int64(0)
	if len(rows[0].Count) > 0 {
		count = rows[0].Count[0].Count
	}
	if count == 0 {
		return searchCollectionResult{}, 0, nil
	}
	raw, err := toExtJSON(rows[0].Sample)
	if err != nil {
		return searchCollectionResult{}, 0, err
	}
	return searchCollectionResult{Count: count, Sample: raw}, count, nil
}

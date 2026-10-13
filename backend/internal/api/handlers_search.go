package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// searchTimeout bounds a whole-database scan so a broad search cannot pin a
// connection for the full operation timeout.
const searchTimeout = 30 * time.Second

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

// searchDatabase looks for a term across every collection of a database.
//
// It scans with $objectToArray, which is intentionally broad but can be slow on
// large collections; the whole request is bounded by searchTimeout and the
// number of collections is capped by the caller.
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

	ctx, cancel := context.WithTimeout(r.Context(), searchTimeout)
	defer cancel()

	db := client.Database(chi.URLParam(r, "db"))
	names, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		a.dbErr(w, err)
		return
	}

	results := make([]searchCollectionResult, 0)
	for _, name := range names {
		if strings.HasPrefix(name, "system.") {
			continue
		}
		if int64(len(results)) >= maxCollections || ctx.Err() != nil {
			break
		}
		result, matches, err := a.searchCollection(ctx, db.Collection(name), req.Field, mode, pattern, limit)
		if err != nil || matches == 0 {
			continue
		}
		result.Collection = name
		results = append(results, result)
	}

	ok(w, map[string]any{
		"term":    term,
		"mode":    mode,
		"results": results,
	})
}

// searchCollection returns the match count and a sample for a single collection.
func (a *API) searchCollection(
	ctx context.Context,
	coll *mongo.Collection,
	field, mode, pattern string,
	limit int64,
) (searchCollectionResult, int64, error) {
	// A field-restricted value search is a plain (index-friendly) regex query.
	if mode == "value" && field != "" {
		filter := bson.M{field: bson.M{"$regex": pattern, "$options": "i"}}
		count, err := coll.CountDocuments(ctx, filter)
		if err != nil || count == 0 {
			return searchCollectionResult{}, count, err
		}
		cursor, err := coll.Find(ctx, filter, options.Find().SetLimit(limit))
		if err != nil {
			return searchCollectionResult{}, 0, err
		}
		defer cursor.Close(ctx)
		return searchCollectionResult{Count: count, Sample: collectSamples(ctx, cursor)}, count, nil
	}

	match := searchMatchExpr(mode, pattern)

	countCursor, err := coll.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: match}},
		{{Key: "$count", Value: "count"}},
	})
	if err != nil {
		return searchCollectionResult{}, 0, err
	}
	var counted struct {
		Count int64 `bson:"count"`
	}
	count := int64(0)
	if countCursor.Next(ctx) {
		if err := countCursor.Decode(&counted); err == nil {
			count = counted.Count
		}
	}
	countCursor.Close(ctx)
	if count == 0 {
		return searchCollectionResult{}, 0, nil
	}

	samplePipeline := mongo.Pipeline{
		{{Key: "$match", Value: match}},
		{{Key: "$limit", Value: limit}},
	}
	cursor, err := coll.Aggregate(ctx, samplePipeline)
	if err != nil {
		return searchCollectionResult{}, 0, err
	}
	defer cursor.Close(ctx)
	return searchCollectionResult{Count: count, Sample: collectSamples(ctx, cursor)}, count, nil
}

// collectSamples drains a cursor into a relaxed Extended JSON array.
func collectSamples(ctx context.Context, cursor *mongo.Cursor) json.RawMessage {
	docs := []bson.D{}
	_ = cursor.All(ctx, &docs)
	raw, err := toExtJSON(docs)
	if err != nil {
		return json.RawMessage("[]")
	}
	return raw
}

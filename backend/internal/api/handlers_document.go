package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	defaultLimit = 50
	maxLimit     = 1000
)

type findRequest struct {
	Filter     json.RawMessage `json:"filter"`
	Sort       json.RawMessage `json:"sort"`
	Projection json.RawMessage `json:"projection"`
	Skip       int64           `json:"skip"`
	Limit      int64           `json:"limit"`
}

func (a *API) findDocuments(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req findRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}

	filter, err := parseExtJSOND(string(req.Filter))
	if err != nil {
		badRequest(w, err)
		return
	}
	sortDoc, err := parseExtJSOND(string(req.Sort))
	if err != nil {
		badRequest(w, err)
		return
	}
	proj, err := parseExtJSOND(string(req.Projection))
	if err != nil {
		badRequest(w, err)
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	skip := req.Skip
	if skip < 0 {
		skip = 0
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	total, err := coll.CountDocuments(ctx, filter)
	if err != nil {
		a.dbErr(w, err)
		return
	}

	findOpts := options.Find().SetSkip(skip).SetLimit(limit)
	if len(sortDoc) > 0 {
		findOpts.SetSort(sortDoc)
	}
	if len(proj) > 0 {
		findOpts.SetProjection(proj)
	}

	cursor, err := coll.Find(ctx, filter, findOpts)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	defer cursor.Close(ctx)

	docs := []bson.D{}
	if err := cursor.All(ctx, &docs); err != nil {
		a.dbErr(w, err)
		return
	}
	raw, err := toExtJSON(docs)
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"documents": raw,
			"total":     total,
			"skip":      skip,
			"limit":     limit,
		},
	})
}

type insertRequest struct {
	Documents []json.RawMessage `json:"documents"`
}

func (a *API) insertDocuments(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req insertRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}
	if len(req.Documents) == 0 {
		badRequest(w, errors.New("no documents provided"))
		return
	}

	docs := make([]any, 0, len(req.Documents))
	for i, rawDoc := range req.Documents {
		d, err := parseExtJSOND(string(rawDoc))
		if err != nil {
			badRequest(w, err)
			return
		}
		if len(d) == 0 {
			badRequest(w, errors.New("document cannot be empty (index "+strconv.Itoa(i)+")"))
			return
		}
		docs = append(docs, d)
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	var ids []any
	if len(docs) == 1 {
		res, err := coll.InsertOne(ctx, docs[0])
		if err != nil {
			a.dbErr(w, err)
			return
		}
		ids = append(ids, res.InsertedID)
	} else {
		res, err := coll.InsertMany(ctx, docs, options.InsertMany().SetOrdered(true))
		if err != nil {
			a.dbErr(w, err)
			return
		}
		ids = append(ids, res.InsertedIDs...)
	}

	raw, err := toExtJSON(ids)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{"insertedCount": len(ids), "insertedIds": raw},
	})
}

type updateRequest struct {
	Filter json.RawMessage `json:"filter"`
	Update json.RawMessage `json:"update"`
	Many   bool            `json:"many"`
	Upsert bool            `json:"upsert"`
}

func (a *API) updateDocuments(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req updateRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}
	filter, err := parseExtJSOND(string(req.Filter))
	if err != nil {
		badRequest(w, err)
		return
	}
	update, err := parseExtJSOND(string(req.Update))
	if err != nil {
		badRequest(w, err)
		return
	}
	if len(update) == 0 {
		badRequest(w, errors.New("update document cannot be empty"))
		return
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	// A document without update operators is treated as a full replacement.
	if !hasUpdateOperator(update) {
		res, err := coll.ReplaceOne(ctx, filter, update, options.Replace().SetUpsert(req.Upsert))
		if err != nil {
			a.dbErr(w, err)
			return
		}
		payload := map[string]any{
			"matchedCount":  res.MatchedCount,
			"modifiedCount": res.ModifiedCount,
			"upsertedCount": res.UpsertedCount,
		}
		if res.UpsertedID != nil {
			if raw, err := toExtJSON(res.UpsertedID); err == nil {
				payload["upsertedId"] = raw
			}
		}
		ok(w, payload)
		return
	}

	opts := options.Update().SetUpsert(req.Upsert)
	var res *mongo.UpdateResult
	if req.Many {
		res, err = coll.UpdateMany(ctx, filter, update, opts)
	} else {
		res, err = coll.UpdateOne(ctx, filter, update, opts)
	}
	if err != nil {
		a.dbErr(w, err)
		return
	}

	payload := map[string]any{
		"matchedCount":  res.MatchedCount,
		"modifiedCount": res.ModifiedCount,
		"upsertedCount": res.UpsertedCount,
	}
	if res.UpsertedID != nil {
		if raw, err := toExtJSON(res.UpsertedID); err == nil {
			payload["upsertedId"] = raw
		}
	}
	ok(w, payload)
}

type deleteRequest struct {
	Filter json.RawMessage `json:"filter"`
	Many   bool            `json:"many"`
}

func (a *API) deleteDocuments(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req deleteRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}
	filter, err := parseExtJSOND(string(req.Filter))
	if err != nil {
		badRequest(w, err)
		return
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	var res *mongo.DeleteResult
	if req.Many {
		res, err = coll.DeleteMany(ctx, filter)
	} else {
		res, err = coll.DeleteOne(ctx, filter)
	}
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ok(w, map[string]any{"deletedCount": res.DeletedCount})
}

type aggregateRequest struct {
	Pipeline json.RawMessage `json:"pipeline"`
	Limit    int64           `json:"limit"`
}

func (a *API) aggregate(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req aggregateRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}

	stages := []bson.D{}
	if s := strings.TrimSpace(string(req.Pipeline)); s != "" && s != "null" {
		if err := bson.UnmarshalExtJSON([]byte(s), false, &stages); err != nil {
			badRequest(w, errors.New("invalid pipeline: "+err.Error()))
			return
		}
	}
	pipeline := mongo.Pipeline(stages)
	if req.Limit > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: req.Limit}})
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	cursor, err := coll.Aggregate(ctx, pipeline)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	defer cursor.Close(ctx)

	docs := []bson.D{}
	if err := cursor.All(ctx, &docs); err != nil {
		a.dbErr(w, err)
		return
	}
	raw, err := toExtJSON(docs)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{"documents": raw, "count": len(docs)},
	})
}

type fieldStat struct {
	Name  string         `json:"name"`
	Count int            `json:"count"`
	Types map[string]int `json:"types"`
}

// collectionSchema samples documents and summarises top-level field types.
func (a *API) collectionSchema(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ctx, cancel := withTimeout(r)
	defer cancel()

	cursor, err := coll.Find(ctx, bson.D{}, options.Find().SetLimit(200))
	if err != nil {
		a.dbErr(w, err)
		return
	}
	defer cursor.Close(ctx)

	var docs []bson.Raw
	if err := cursor.All(ctx, &docs); err != nil {
		a.dbErr(w, err)
		return
	}

	stats := map[string]*fieldStat{}
	for _, doc := range docs {
		elems, err := doc.Elements()
		if err != nil {
			continue
		}
		for _, e := range elems {
			key := e.Key()
			st, ok := stats[key]
			if !ok {
				st = &fieldStat{Name: key, Types: map[string]int{}}
				stats[key] = st
			}
			st.Count++
			st.Types[e.Value().Type.String()]++
		}
	}

	fields := make([]*fieldStat, 0, len(stats))
	for _, st := range stats {
		fields = append(fields, st)
	}
	sort.Slice(fields, func(i, j int) bool {
		if fields[i].Count != fields[j].Count {
			return fields[i].Count > fields[j].Count
		}
		return fields[i].Name < fields[j].Name
	})

	ok(w, map[string]any{
		"sampled": len(docs),
		"fields":  fields,
	})
}

func hasUpdateOperator(update bson.D) bool {
	for _, e := range update {
		if strings.HasPrefix(e.Key, "$") {
			return true
		}
	}
	return false
}

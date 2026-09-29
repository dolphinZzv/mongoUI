package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"mongoui/internal/sqlmongo"
)

type sqlRequest struct {
	Query string `json:"query"`
	// Limit optionally overrides the SQL LIMIT / default cap.
	Limit int64 `json:"limit"`
}

// runSQL translates a SQL SELECT into a MongoDB find or aggregation and runs it
// against the database in the URL.
func (a *API) runSQL(w http.ResponseWriter, r *http.Request) {
	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}

	var req sqlRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}
	if strings.TrimSpace(req.Query) == "" {
		badRequest(w, errors.New("query is required"))
		return
	}

	query, err := sqlmongo.Translate(req.Query)
	if err != nil {
		badRequest(w, err)
		return
	}
	if query.Collection == "" {
		badRequest(w, errors.New("FROM must name a collection"))
		return
	}

	limit := query.Limit
	if req.Limit > 0 {
		limit = req.Limit
	}
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	skip := query.Skip
	if skip < 0 {
		skip = 0
	}

	db := chi.URLParam(r, "db")
	coll := client.Database(db).Collection(query.Collection)

	ctx, cancel := withTimeout(r)
	defer cancel()

	docs := []bson.D{}
	var total int64
	if query.Aggregate {
		pipeline := make(mongo.Pipeline, 0, len(query.Pipeline)+2)
		pipeline = append(pipeline, query.Pipeline...)
		if skip > 0 {
			pipeline = append(pipeline, bson.D{{Key: "$skip", Value: skip}})
		}
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: limit}})

		cursor, err := coll.Aggregate(ctx, pipeline)
		if err != nil {
			a.dbErr(w, err)
			return
		}
		defer cursor.Close(ctx)
		if err := cursor.All(ctx, &docs); err != nil {
			a.dbErr(w, err)
			return
		}
		total = int64(len(docs))
	} else {
		total, err = coll.CountDocuments(ctx, query.Filter)
		if err != nil {
			a.dbErr(w, err)
			return
		}
		findOpts := options.Find().SetSkip(skip).SetLimit(limit)
		if len(query.Sort) > 0 {
			findOpts.SetSort(query.Sort)
		}
		if len(query.Projection) > 0 {
			findOpts.SetProjection(query.Projection)
		}
		cursor, err := coll.Find(ctx, query.Filter, findOpts)
		if err != nil {
			a.dbErr(w, err)
			return
		}
		defer cursor.Close(ctx)
		if err := cursor.All(ctx, &docs); err != nil {
			a.dbErr(w, err)
			return
		}
	}

	raw, err := toExtJSON(docs)
	if err != nil {
		serverError(w, err)
		return
	}

	ok(w, map[string]any{
		"documents": raw,
		"count":     len(docs),
		"total":     total,
		"skip":      skip,
		"limit":     limit,
		"columns":   query.Columns,
		"mql":       generatedMQL(query),
	})
}

// generatedMQL exposes the MongoDB query the SQL was translated into, so the UI
// can show it (and users can learn the mapping).
func generatedMQL(query *sqlmongo.Query) map[string]any {
	if query.Aggregate {
		return map[string]any{
			"type":     "aggregate",
			"pipeline": json.RawMessage(extJSONOrNull(query.Pipeline)),
		}
	}
	mql := map[string]any{
		"type":   "find",
		"filter": json.RawMessage(extJSONOrNull(query.Filter)),
	}
	if len(query.Sort) > 0 {
		mql["sort"] = json.RawMessage(extJSONOrNull(query.Sort))
	}
	if len(query.Projection) > 0 {
		mql["projection"] = json.RawMessage(extJSONOrNull(query.Projection))
	}
	return mql
}

func extJSONOrNull(v any) []byte {
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array {
		wrapped, err := bson.MarshalExtJSON(bson.D{{Key: "v", Value: v}}, false, false)
		if err != nil {
			return []byte("null")
		}
		var m map[string]json.RawMessage
		if err := json.Unmarshal(wrapped, &m); err != nil {
			return []byte("null")
		}
		if raw, ok := m["v"]; ok {
			return raw
		}
		return []byte("[]")
	}
	raw, err := bson.MarshalExtJSON(v, false, false)
	if err != nil {
		return []byte("null")
	}
	return raw
}

package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (a *API) listIndexes(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ctx, cancel := withTimeout(r)
	defer cancel()

	cursor, err := coll.Indexes().List(ctx)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	defer cursor.Close(ctx)

	var idx []bson.D
	if err := cursor.All(ctx, &idx); err != nil {
		a.dbErr(w, err)
		return
	}
	raw, err := toExtJSON(idx)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, raw)
}

type createIndexRequest struct {
	Keys    json.RawMessage `json:"keys"`
	Options json.RawMessage `json:"options"`
}

func (a *API) createIndex(w http.ResponseWriter, r *http.Request) {
	if !a.requireWrite(w, r) {
		return
	}
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req createIndexRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}

	keys, err := parseExtJSOND(string(req.Keys))
	if err != nil {
		badRequest(w, err)
		return
	}
	if len(keys) == 0 {
		badRequest(w, errors.New("index keys are required, e.g. {\"field\": 1}"))
		return
	}

	idxOpts := options.Index()
	if s := string(req.Options); s != "" && s != "null" {
		if err := parseExtJSONInto(s, idxOpts); err != nil {
			badRequest(w, errors.New("invalid index options: "+err.Error()))
			return
		}
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	name, err := coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    keys,
		Options: idxOpts,
	})
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ok(w, map[string]any{"name": name})
}

func (a *API) dropIndex(w http.ResponseWriter, r *http.Request) {
	if !a.requireWrite(w, r) {
		return
	}
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	name := chi.URLParam(r, "name")
	if name == "" {
		badRequest(w, errors.New("index name is required"))
		return
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	if _, err := coll.Indexes().DropOne(ctx, name); err != nil {
		a.dbErr(w, err)
		return
	}
	ok(w, map[string]any{"dropped": name})
}

type updateIndexRequest struct {
	Hidden             *bool  `json:"hidden"`
	ExpireAfterSeconds *int64 `json:"expireAfterSeconds"`
}

// updateIndex changes the options MongoDB allows modifying in place via collMod:
// whether the index is hidden and its TTL. Everything else (keys, unique,
// sparse, partial filter, collation, ...) requires dropping and recreating the
// index, which the UI performs explicitly.
func (a *API) updateIndex(w http.ResponseWriter, r *http.Request) {
	if !a.requireWrite(w, r) {
		return
	}
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	name := chi.URLParam(r, "name")
	if name == "" {
		badRequest(w, errors.New("index name is required"))
		return
	}
	var req updateIndexRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}
	if req.Hidden == nil && req.ExpireAfterSeconds == nil {
		badRequest(w, errors.New("provide hidden and/or expireAfterSeconds"))
		return
	}

	index := bson.D{{Key: "name", Value: name}}
	if req.Hidden != nil {
		index = append(index, bson.E{Key: "hidden", Value: *req.Hidden})
	}
	if req.ExpireAfterSeconds != nil {
		index = append(index, bson.E{Key: "expireAfterSeconds", Value: *req.ExpireAfterSeconds})
	}
	cmd := bson.D{
		{Key: "collMod", Value: coll.Name()},
		{Key: "index", Value: index},
	}

	ctx, cancel := withTimeout(r)
	defer cancel()
	if err := coll.Database().RunCommand(ctx, cmd).Err(); err != nil {
		a.dbErr(w, err)
		return
	}
	ok(w, map[string]any{"updated": name})
}

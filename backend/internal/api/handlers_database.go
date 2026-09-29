package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (a *API) listDatabases(w http.ResponseWriter, r *http.Request) {
	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ctx, cancel := withTimeout(r)
	defer cancel()

	res, err := client.ListDatabases(ctx, bson.M{})
	if err != nil {
		a.dbErr(w, err)
		return
	}
	dbs := make([]map[string]any, 0, len(res.Databases))
	for _, d := range res.Databases {
		dbs = append(dbs, map[string]any{
			"name":       d.Name,
			"sizeOnDisk": d.SizeOnDisk,
			"empty":      d.Empty,
		})
	}
	ok(w, map[string]any{
		"databases": dbs,
		"totalSize": res.TotalSize,
	})
}

func (a *API) createDatabase(w http.ResponseWriter, r *http.Request) {
	if !a.requireWrite(w, r) {
		return
	}
	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var body struct {
		Name       string `json:"name"`
		Collection string `json:"collection"`
	}
	if err := decodeJSON(r, &body); err != nil {
		badRequest(w, err)
		return
	}
	if body.Name == "" {
		badRequest(w, errors.New("database name is required"))
		return
	}
	if body.Collection == "" {
		body.Collection = "default"
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	if err := client.Database(body.Name).CreateCollection(ctx, body.Collection); err != nil {
		a.dbErr(w, err)
		return
	}
	ok(w, map[string]any{"name": body.Name})
}

func (a *API) dropDatabase(w http.ResponseWriter, r *http.Request) {
	if !a.requireWrite(w, r) {
		return
	}
	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ctx, cancel := withTimeout(r)
	defer cancel()

	db := chi.URLParam(r, "db")
	if err := client.Database(db).Drop(ctx); err != nil {
		a.dbErr(w, err)
		return
	}
	ok(w, map[string]any{"dropped": db})
}

func (a *API) databaseStats(w http.ResponseWriter, r *http.Request) {
	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ctx, cancel := withTimeout(r)
	defer cancel()

	var res bson.D
	err = client.Database(chi.URLParam(r, "db")).RunCommand(ctx, bson.D{{Key: "dbStats", Value: 1}}).Decode(&res)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	raw, err := toExtJSON(res)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, raw)
}

func (a *API) listCollections(w http.ResponseWriter, r *http.Request) {
	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ctx, cancel := withTimeout(r)
	defer cancel()

	cursor, err := client.Database(chi.URLParam(r, "db")).ListCollections(ctx, bson.M{})
	if err != nil {
		a.dbErr(w, err)
		return
	}
	defer cursor.Close(ctx)

	var cols []bson.D
	if err := cursor.All(ctx, &cols); err != nil {
		a.dbErr(w, err)
		return
	}
	raw, err := toExtJSON(cols)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, raw)
}

func (a *API) createCollection(w http.ResponseWriter, r *http.Request) {
	if !a.requireWrite(w, r) {
		return
	}
	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var body struct {
		Name    string `json:"name"`
		Capped  bool   `json:"capped"`
		Size    int64  `json:"size"`
		MaxDocs int64  `json:"max"`
	}
	if err := decodeJSON(r, &body); err != nil {
		badRequest(w, err)
		return
	}
	if body.Name == "" {
		badRequest(w, errors.New("collection name is required"))
		return
	}

	opts := options.CreateCollection()
	if body.Capped {
		opts.SetCapped(true)
		if body.Size > 0 {
			opts.SetSizeInBytes(body.Size)
		}
		if body.MaxDocs > 0 {
			opts.SetMaxDocuments(body.MaxDocs)
		}
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	if err := client.Database(chi.URLParam(r, "db")).CreateCollection(ctx, body.Name, opts); err != nil {
		a.dbErr(w, err)
		return
	}
	ok(w, map[string]any{"name": body.Name})
}

func (a *API) dropCollection(w http.ResponseWriter, r *http.Request) {
	if !a.requireWrite(w, r) {
		return
	}
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ctx, cancel := withTimeout(r)
	defer cancel()

	if err := coll.Drop(ctx); err != nil {
		a.dbErr(w, err)
		return
	}
	ok(w, map[string]any{"dropped": coll.Name()})
}

func (a *API) collectionStats(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ctx, cancel := withTimeout(r)
	defer cancel()

	var res bson.D
	err = coll.Database().RunCommand(ctx, bson.D{{Key: "collStats", Value: coll.Name()}}).Decode(&res)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	raw, err := toExtJSON(res)
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, raw)
}

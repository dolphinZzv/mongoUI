package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// databaseProfile reads slow operations from the database profiler
// (db.system.profile). Profiling is a database-level setting; when it is off the
// collection does not exist and we report enabled=false instead of an error.
func (a *API) databaseProfile(w http.ResponseWriter, r *http.Request) {
	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}

	limit := 100
	if value, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && value > 0 && value <= 1000 {
		limit = value
	}
	minMillis := 0
	if value, err := strconv.Atoi(r.URL.Query().Get("minMillis")); err == nil && value > 0 {
		minMillis = value
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	collection := client.Database(chi.URLParam(r, "db")).Collection("system.profile")
	filter := bson.D{}
	if minMillis > 0 {
		filter = bson.D{{Key: "millis", Value: bson.D{{Key: "$gte", Value: minMillis}}}}
	}
	cursor, err := collection.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "ts", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		if isNamespaceNotFound(err) {
			ok(w, map[string]any{"enabled": false, "entries": []any{}})
			return
		}
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
	ok(w, map[string]any{"enabled": true, "entries": raw})
}

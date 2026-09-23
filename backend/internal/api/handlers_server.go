package api

import (
	"net/http"

	"go.mongodb.org/mongo-driver/bson"
)

// serverInfo returns best-effort server metadata. Commands that require
// elevated privileges are skipped rather than failing the whole request.
func (a *API) serverInfo(w http.ResponseWriter, r *http.Request) {
	client, err := a.client(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ctx, cancel := withTimeout(r)
	defer cancel()

	admin := client.Database("admin")
	result := map[string]any{}

	var hello bson.D
	if err := admin.RunCommand(ctx, bson.D{{Key: "hello", Value: 1}}).Decode(&hello); err == nil {
		if raw, err := toExtJSON(hello); err == nil {
			result["hello"] = raw
		}
	} else {
		result["helloError"] = err.Error()
	}

	var build bson.D
	if err := admin.RunCommand(ctx, bson.D{{Key: "buildInfo", Value: 1}}).Decode(&build); err == nil {
		if raw, err := toExtJSON(build); err == nil {
			result["buildInfo"] = raw
		}
	}

	ok(w, result)
}

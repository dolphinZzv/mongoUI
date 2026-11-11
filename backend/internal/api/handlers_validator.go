package api

import (
	"net/http"

	"go.mongodb.org/mongo-driver/bson"
)

type validatorInput struct {
	Validator        bson.M `json:"validator"`
	ValidationLevel  string `json:"validationLevel"`
	ValidationAction string `json:"validationAction"`
}

// getValidator returns the collection's JSON Schema validator.
func (a *API) getValidator(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ctx, cancel := withTimeout(r)
	defer cancel()

	var result struct {
		Cursor struct {
			FirstBatch []bson.M `bson:"firstBatch"`
		} `bson:"cursor"`
	}
	err = coll.Database().RunCommand(ctx, bson.D{
		{Key: "listCollections", Value: 1},
		{Key: "filter", Value: bson.D{{Key: "name", Value: coll.Name()}}},
	}).Decode(&result)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	options := bson.M{}
	if len(result.Cursor.FirstBatch) > 0 {
		options, _ = result.Cursor.FirstBatch[0]["options"].(bson.M)
	}
	ok(w, map[string]any{
		"validator":        options["validator"],
		"validationLevel":  options["validationLevel"],
		"validationAction": options["validationAction"],
	})
}

// updateValidator applies a JSON Schema validator through collMod.
func (a *API) updateValidator(w http.ResponseWriter, r *http.Request) {
	if !a.requireWrite(w, r) {
		return
	}
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var in validatorInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	level := in.ValidationLevel
	if level != "strict" && level != "moderate" {
		level = "strict"
	}
	action := in.ValidationAction
	if action != "error" && action != "warn" {
		action = "error"
	}
	if in.Validator == nil {
		in.Validator = bson.M{}
	}
	ctx, cancel := withTimeout(r)
	defer cancel()
	err = coll.Database().RunCommand(ctx, bson.D{
		{Key: "collMod", Value: coll.Name()},
		{Key: "validator", Value: in.Validator},
		{Key: "validationLevel", Value: level},
		{Key: "validationAction", Value: action},
	}).Err()
	if err != nil {
		a.dbErr(w, err)
		return
	}
	ok(w, map[string]any{"saved": true})
}

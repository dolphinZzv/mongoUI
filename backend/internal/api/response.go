package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

// opTimeout is the default timeout applied to database operations.
const opTimeout = 60 * time.Second

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	enc := json.NewEncoder(w)
	if err := enc.Encode(v); err != nil {
		// Response already partially written; nothing else we can do.
		_ = err
	}
}

func ok(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}

func fail(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{"error": err.Error()})
}

func badRequest(w http.ResponseWriter, err error) {
	fail(w, http.StatusBadRequest, err)
}

func serverError(w http.ResponseWriter, err error) {
	fail(w, http.StatusInternalServerError, err)
}

// decodeJSON decodes the request body into v, tolerating an empty body.
func decodeJSON(r *http.Request, v any) error {
	if r.Body == nil {
		return nil
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(v); err != nil {
		if err.Error() == "EOF" {
			return nil
		}
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	return nil
}

// toExtJSON marshals a BSON value to relaxed Extended JSON.
// Top-level slices are wrapped in a document first because the BSON encoder
// only accepts a document at the root.
func toExtJSON(v any) (json.RawMessage, error) {
	if v == nil {
		return json.RawMessage("null"), nil
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array {
		wrapped, err := bson.MarshalExtJSON(bson.D{{Key: "v", Value: v}}, false, false)
		if err != nil {
			return nil, err
		}
		var m map[string]json.RawMessage
		if err := json.Unmarshal(wrapped, &m); err != nil {
			return nil, err
		}
		if raw, found := m["v"]; found {
			return raw, nil
		}
		return json.RawMessage("[]"), nil
	}
	raw, err := bson.MarshalExtJSON(v, false, false)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(raw), nil
}

// parseExtJSOND parses a relaxed Extended JSON object into an ordered bson.D.
// Empty / whitespace-only input yields an empty document.
func parseExtJSOND(s string) (bson.D, error) {
	s = strings.TrimSpace(s)
	if s == "" || s == "null" {
		return bson.D{}, nil
	}
	var d bson.D
	if err := bson.UnmarshalExtJSON([]byte(s), false, &d); err != nil {
		return nil, fmt.Errorf("invalid filter/query JSON: %w", err)
	}
	if d == nil {
		d = bson.D{}
	}
	return d, nil
}

// parseExtJSON parses relaxed Extended JSON into an arbitrary bson value.
func parseExtJSON(s string) (bson.Raw, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		s = "{}"
	}
	var raw bson.Raw
	if err := bson.UnmarshalExtJSON([]byte(s), false, &raw); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	return raw, nil
}

// parseExtJSONInto parses Extended JSON into a target BSON struct.
func parseExtJSONInto(s string, target any) error {
	s = strings.TrimSpace(s)
	if s == "" || s == "null" {
		return nil
	}
	return bson.UnmarshalExtJSON([]byte(s), false, target)
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

func withTimeout(r *http.Request) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), opTimeout)
}

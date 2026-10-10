package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

// Integration tests run only when MONGOUI_TEST_MONGO_URI points at a MongoDB
// instance, e.g.
//
//	MONGOUI_TEST_MONGO_URI=mongodb://127.0.0.1:27017 go test ./internal/api/
func integrationAPI(t *testing.T) (http.Handler, string) {
	t.Helper()
	uri := os.Getenv("MONGOUI_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set MONGOUI_TEST_MONGO_URI to run the MongoDB integration tests")
	}
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	conn, err := store.Add(config.Connection{Name: "it", URI: uri})
	if err != nil {
		t.Fatalf("add connection: %v", err)
	}
	mgr := mongoclient.NewManager()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := mgr.Connect(ctx, conn.ID, uri, nil); err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(mgr.CloseAll)

	db := fmt.Sprintf("mongoui_it_%d", time.Now().UnixNano())
	api := New(store, mgr, true, "test", nil, nil)
	t.Cleanup(func() {
		client, err := mgr.Get(conn.ID)
		if err != nil {
			return
		}
		_ = client.Database(db).Drop(context.Background())
	})
	return api.Router(nil), db
}

func doJSON(t *testing.T, handler http.Handler, method, path, body string) (int, map[string]any) {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var envelope map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
			t.Fatalf("%s %s: decode response %q: %v", method, path, rec.Body.String(), err)
		}
	}
	return rec.Code, envelope
}

func dataOf(t *testing.T, envelope map[string]any) map[string]any {
	t.Helper()
	raw, ok := envelope["data"].(map[string]any)
	if !ok {
		t.Fatalf("response has no data object: %#v", envelope)
	}
	return raw
}

func TestIntegrationDataOperations(t *testing.T) {
	handler, db := integrationAPI(t)
	base := "/api/connections"
	status, env := doJSON(t, handler, http.MethodGet, base+"/", "")
	if status != http.StatusOK {
		t.Fatalf("list connections: status %d", status)
	}
	list, ok := env["data"].([]any)
	if !ok || len(list) == 0 {
		t.Fatalf("expected at least one connection, got %#v", env)
	}
	connID := list[0].(map[string]any)["id"].(string)

	collPath := func(col string) string {
		return fmt.Sprintf("%s/%s/databases/%s/collections/%s", base, connID, db, col)
	}

	// Seed documents.
	seed := `{"documents":[
		{"name":"Alice","age":30,"active":true,"tags":["a","b"]},
		{"name":"Bob","age":25,"active":false,"tags":["b"]},
		{"name":"Carol","age":40,"active":true}
	]}`
	status, _ = doJSON(t, handler, http.MethodPost, collPath("people")+"/insert", seed)
	if status != http.StatusOK {
		t.Fatalf("insert: status %d", status)
	}

	// Add a secondary index so the copy can be checked to recreate it.
	status, env = doJSON(t, handler, http.MethodPost, collPath("people")+"/indexes",
		`{"keys":{"name":1},"options":{"name":"name_1"}}`)
	if status != http.StatusOK {
		t.Fatalf("create index: status %d body %#v", status, env)
	}

	// Export JSON.
	status, env = doJSON(t, handler, http.MethodPost, collPath("people")+"/export",
		`{"format":"json","filter":{"active":true}}`)
	if status != http.StatusOK {
		t.Fatalf("export json: status %d body %#v", status, env)
	}
	exported := dataOf(t, env)
	if exported["count"].(float64) != 2 {
		t.Fatalf("export json count = %v, want 2", exported["count"])
	}
	if !strings.Contains(exported["content"].(string), "Alice") {
		t.Fatalf("export json missing Alice: %s", exported["content"])
	}
	if !strings.HasSuffix(exported["filename"].(string), ".json") {
		t.Fatalf("unexpected filename: %v", exported["filename"])
	}

	// Export CSV.
	status, env = doJSON(t, handler, http.MethodPost, collPath("people")+"/export", `{"format":"csv"}`)
	if status != http.StatusOK {
		t.Fatalf("export csv: status %d body %#v", status, env)
	}
	csv := dataOf(t, env)["content"].(string)
	lines := strings.Split(strings.TrimSpace(csv), "\n")
	if !strings.Contains(lines[0], "name") || !strings.Contains(lines[0], "age") {
		t.Fatalf("unexpected csv header: %q", lines[0])
	}
	if len(lines) != 4 {
		t.Fatalf("expected header + 3 rows, got %d lines: %q", len(lines), csv)
	}

	// Import JSON (array).
	status, env = doJSON(t, handler, http.MethodPost, collPath("imported")+"/import",
		`{"format":"json","content":"[{\"name\":\"Dave\"},{\"name\":\"Erin\"}]"}`)
	if status != http.StatusOK {
		t.Fatalf("import json: status %d body %#v", status, env)
	}
	if got := dataOf(t, env)["insertedCount"].(float64); got != 2 {
		t.Fatalf("import json insertedCount = %v, want 2", got)
	}

	// Import CSV.
	status, env = doJSON(t, handler, http.MethodPost, collPath("imported_csv")+"/import",
		`{"format":"csv","content":"name,age,active\nFrank,33,true\n"}`)
	if status != http.StatusOK {
		t.Fatalf("import csv: status %d body %#v", status, env)
	}
	if got := dataOf(t, env)["insertedCount"].(float64); got != 1 {
		t.Fatalf("import csv insertedCount = %v, want 1", got)
	}

	// Copy the collection (with indexes) into another collection.
	status, env = doJSON(t, handler, http.MethodPost, collPath("people")+"/copy",
		fmt.Sprintf(`{"targetDatabase":%q,"targetCollection":"people_copy","dropTarget":true,"copyIndexes":true}`, db))
	if status != http.StatusOK {
		t.Fatalf("copy: status %d body %#v", status, env)
	}
	copied := dataOf(t, env)
	if copied["copied"].(float64) != 3 {
		t.Fatalf("copied = %v, want 3", copied["copied"])
	}
	if copied["indexesCopied"].(float64) != 1 {
		t.Fatalf("indexesCopied = %v, want 1", copied["indexesCopied"])
	}

	// Explain a find query.
	status, env = doJSON(t, handler, http.MethodPost, collPath("people")+"/explain",
		`{"type":"find","filter":{"age":{"$gt":20}},"verbosity":"executionStats"}`)
	if status != http.StatusOK {
		t.Fatalf("explain: status %d body %#v", status, env)
	}
	plan := dataOf(t, env)
	if _, ok := plan["queryPlanner"]; !ok {
		t.Fatalf("explain result missing queryPlanner: %#v", plan)
	}

	// Explain an aggregation.
	status, env = doJSON(t, handler, http.MethodPost, collPath("people")+"/explain",
		`{"type":"aggregate","pipeline":[{"$match":{"active":true}}],"verbosity":"queryPlanner"}`)
	if status != http.StatusOK {
		t.Fatalf("explain aggregate: status %d body %#v", status, env)
	}

	// Round-trip the copied collection back as an export.
	status, env = doJSON(t, handler, http.MethodPost, collPath("people_copy")+"/export", `{"format":"json"}`)
	if status != http.StatusOK {
		t.Fatalf("export copy: status %d body %#v", status, env)
	}
	if got := dataOf(t, env)["count"].(float64); got != 3 {
		t.Fatalf("copied export count = %v, want 3", got)
	}
}

func TestIntegrationReadOnlyImportRejected(t *testing.T) {
	uri := os.Getenv("MONGOUI_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set MONGOUI_TEST_MONGO_URI to run the MongoDB integration tests")
	}
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	conn, err := store.Add(config.Connection{Name: "ro", URI: uri, ReadOnly: true})
	if err != nil {
		t.Fatalf("add connection: %v", err)
	}
	mgr := mongoclient.NewManager()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := mgr.Connect(ctx, conn.ID, uri, nil); err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(mgr.CloseAll)
	handler := New(store, mgr, true, "test", nil, nil).Router(nil)

	path := fmt.Sprintf("/api/connections/%s/databases/mongoui_it_ro/collections/c/import", conn.ID)
	status, _ := doJSON(t, handler, http.MethodPost, path, `{"format":"json","content":"[{\"a\":1}]"}`)
	if status != http.StatusForbidden {
		t.Fatalf("import on read-only connection: status %d, want 403", status)
	}
}

func TestIntegrationIndexEditor(t *testing.T) {
	handler, db := integrationAPI(t)
	base := "/api/connections"
	_, env := doJSON(t, handler, http.MethodGet, base+"/", "")
	connID := env["data"].([]any)[0].(map[string]any)["id"].(string)
	idxPath := fmt.Sprintf("%s/%s/databases/%s/collections/idx/indexes", base, connID, db)

	// Create a unique index and a TTL index.
	status, env := doJSON(t, handler, http.MethodPost, idxPath,
		`{"keys":{"email":1},"options":{"name":"email_1","unique":true}}`)
	if status != http.StatusOK {
		t.Fatalf("create unique index: status %d body %#v", status, env)
	}
	status, env = doJSON(t, handler, http.MethodPost, idxPath,
		`{"keys":{"createdAt":1},"options":{"name":"ttl_1","expireAfterSeconds":3600}}`)
	if status != http.StatusOK {
		t.Fatalf("create ttl index: status %d body %#v", status, env)
	}

	find := func() map[string]any {
		t.Helper()
		status, env := doJSON(t, handler, http.MethodGet, idxPath, "")
		if status != http.StatusOK {
			t.Fatalf("list indexes: status %d body %#v", status, env)
		}
		for _, item := range env["data"].([]any) {
			index := item.(map[string]any)
			if index["name"] == "email_1" || index["name"] == "ttl_1" {
				return index
			}
		}
		return nil
	}

	// Hide the unique index in place.
	status, env = doJSON(t, handler, http.MethodPatch, idxPath+"/email_1", `{"hidden":true}`)
	if status != http.StatusOK {
		t.Fatalf("hide index: status %d body %#v", status, env)
	}
	if got := find(); got == nil || got["name"] != "email_1" || got["hidden"] != true {
		t.Fatalf("email_1 not hidden: %#v", got)
	}

	// Update the TTL in place.
	status, env = doJSON(t, handler, http.MethodPatch, idxPath+"/ttl_1", `{"expireAfterSeconds":60}`)
	if status != http.StatusOK {
		t.Fatalf("update ttl: status %d body %#v", status, env)
	}
	// The list is a flat slice; scan again for the TTL index.
	_, env = doJSON(t, handler, http.MethodGet, idxPath, "")
	for _, item := range env["data"].([]any) {
		index := item.(map[string]any)
		if index["name"] == "ttl_1" {
			if index["expireAfterSeconds"].(float64) != 60 {
				t.Fatalf("ttl not updated: %#v", index)
			}
		}
	}

	// An update without any field is rejected.
	status, _ = doJSON(t, handler, http.MethodPatch, idxPath+"/email_1", `{}`)
	if status != http.StatusBadRequest {
		t.Fatalf("empty update: status %d, want 400", status)
	}

	// Drop the unique index.
	status, env = doJSON(t, handler, http.MethodDelete, idxPath+"/email_1", "")
	if status != http.StatusOK {
		t.Fatalf("drop index: status %d body %#v", status, env)
	}
}

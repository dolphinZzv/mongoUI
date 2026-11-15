package api

import (
	"net/http"
	"path/filepath"
	"testing"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func TestSavedMQLFilters(t *testing.T) {
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	handler := New(store, mongoclient.NewManager(), true, "test", nil, nil).Router(nil)
	body := `{"scope":"c1::db::users","queries":[{"id":"q1","name":"Active users","kind":"mql","text":"{\"status\":\"active\"}"}]}`
	status, env := doJSON(t, handler, http.MethodPut, "/api/queries", body)
	if status != http.StatusOK {
		t.Fatalf("save MQL filter = %d: %#v", status, env)
	}
	status, env = doJSON(t, handler, http.MethodGet, "/api/queries?scope=c1::db::users", "")
	if status != http.StatusOK {
		t.Fatalf("load MQL filters = %d: %#v", status, env)
	}
	queries, ok := dataOf(t, env)["queries"].([]any)
	if !ok || len(queries) != 1 || queries[0].(map[string]any)["kind"] != "mql" {
		t.Fatalf("unexpected saved MQL filters: %#v", dataOf(t, env)["queries"])
	}
}

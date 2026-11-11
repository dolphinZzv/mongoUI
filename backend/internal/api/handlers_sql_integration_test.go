package api

import (
	"fmt"
	"net/http"
	"testing"
)

func TestIntegrationSQLAggregateTotal(t *testing.T) {
	handler, db := integrationAPI(t)

	code, env := doJSON(t, handler, http.MethodGet, "/api/connections", "")
	if code != http.StatusOK {
		t.Fatalf("list connections: %d %#v", code, env)
	}
	connections, ok := env["data"].([]any)
	if !ok || len(connections) == 0 {
		t.Fatalf("no connections: %#v", env)
	}
	connectionID := connections[0].(map[string]any)["id"].(string)
	base := fmt.Sprintf("/api/connections/%s/databases/%s/collections/events", connectionID, db)

	body := `{"documents":[{"status":"a"},{"status":"b"},{"status":"a"}]}`
	if code, env := doJSON(t, handler, http.MethodPost, base+"/insert", body); code != http.StatusOK {
		t.Fatalf("insert: %d %#v", code, env)
	}

	sqlBody := `{"query":"SELECT status, COUNT(*) AS n FROM events GROUP BY status ORDER BY status","limit":1}`
	code, env = doJSON(t, handler, http.MethodPost,
		fmt.Sprintf("/api/connections/%s/databases/%s/sql", connectionID, db), sqlBody)
	if code != http.StatusOK {
		t.Fatalf("sql: %d %#v", code, env)
	}
	data := dataOf(t, env)
	if got := data["total"].(float64); got != 2 {
		t.Fatalf("total = %v, want 2", got)
	}
	if got := data["count"].(float64); got != 1 {
		t.Fatalf("count = %v, want 1", got)
	}
}

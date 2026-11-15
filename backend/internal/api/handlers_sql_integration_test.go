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
	if data["hasMore"] != true {
		t.Fatalf("first SQL page hasMore = %v, want true", data["hasMore"])
	}

	secondBody := `{"query":"SELECT status, COUNT(*) AS n FROM events GROUP BY status ORDER BY status","limit":1,"skip":1}`
	code, env = doJSON(t, handler, http.MethodPost,
		fmt.Sprintf("/api/connections/%s/databases/%s/sql", connectionID, db), secondBody)
	if code != http.StatusOK {
		t.Fatalf("sql page 2: %d %#v", code, env)
	}
	data = dataOf(t, env)
	if data["skip"].(float64) != 1 || data["count"].(float64) != 1 || data["hasMore"] != false {
		t.Fatalf("sql page 2 = %#v", data)
	}
}

func TestIntegrationAggregatePagination(t *testing.T) {
	handler, db := integrationAPI(t)
	code, env := doJSON(t, handler, http.MethodGet, "/api/connections", "")
	if code != http.StatusOK {
		t.Fatalf("list connections: %d %#v", code, env)
	}
	connections := env["data"].([]any)
	connectionID := connections[0].(map[string]any)["id"].(string)
	base := fmt.Sprintf("/api/connections/%s/databases/%s/collections/agg_page", connectionID, db)
	if code, env := doJSON(t, handler, http.MethodPost, base+"/insert",
		`{"documents":[{"n":1},{"n":2},{"n":3},{"n":4},{"n":5}]}`); code != http.StatusOK {
		t.Fatalf("insert: %d %#v", code, env)
	}
	path := fmt.Sprintf("/api/connections/%s/databases/%s/collections/agg_page/aggregate", connectionID, db)
	code, env = doJSON(t, handler, http.MethodPost, path,
		`{"pipeline":[{"$sort":{"n":1}}],"limit":2,"skip":0}`)
	if code != http.StatusOK {
		t.Fatalf("aggregate page 1: %d %#v", code, env)
	}
	data := dataOf(t, env)
	if data["count"].(float64) != 2 || data["hasMore"] != true {
		t.Fatalf("aggregate page 1 = %#v", data)
	}

	code, env = doJSON(t, handler, http.MethodPost, path,
		`{"pipeline":[{"$sort":{"n":1}}],"limit":2,"skip":4}`)
	if code != http.StatusOK {
		t.Fatalf("aggregate page 3: %d %#v", code, env)
	}
	data = dataOf(t, env)
	if data["count"].(float64) != 1 || data["hasMore"] != false || data["skip"].(float64) != 4 {
		t.Fatalf("aggregate page 3 = %#v", data)
	}
}

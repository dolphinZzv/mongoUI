package api

import (
	"net/http"
	"testing"
)

func TestChartViewsEndpoints(t *testing.T) {
	handler, _ := aiTestAPI(t)

	status, env := doJSON(t, handler, http.MethodPut, "/api/chart-views",
		`{"scope":"conn::db::users","views":[{"id":"v1","name":"Active users","config":{"type":"bar"},"filter":"{}","pinned":true}]}`)
	if status != http.StatusOK {
		t.Fatalf("PUT /api/chart-views status = %d body %#v", status, env)
	}

	status, env = doJSON(t, handler, http.MethodGet, "/api/chart-views?scope=conn%3A%3Adb%3A%3Ausers", "")
	if status != http.StatusOK {
		t.Fatalf("GET scope status = %d body %#v", status, env)
	}
	data := dataOf(t, env)
	views, ok := data["views"].([]any)
	if !ok || len(views) != 1 {
		t.Fatalf("unexpected views: %#v", env)
	}
	if data["version"] != float64(1) {
		t.Fatalf("unexpected version: %#v", data)
	}
	first, _ := views[0].(map[string]any)
	if first["name"] != "Active users" || first["pinned"] != true {
		t.Fatalf("unexpected view: %#v", first)
	}

	status, env = doJSON(t, handler, http.MethodGet, "/api/chart-views?connectionId=conn", "")
	if status != http.StatusOK {
		t.Fatalf("GET connection status = %d body %#v", status, env)
	}
	scopes, ok := dataOf(t, env)["scopes"].(map[string]any)
	if !ok || len(scopes["conn::db::users"].([]any)) != 1 {
		t.Fatalf("unexpected scopes: %#v", dataOf(t, env))
	}
}

func TestChartViewsConflict(t *testing.T) {
	handler, _ := aiTestAPI(t)
	status, _ := doJSON(t, handler, http.MethodPut, "/api/chart-views",
		`{"scope":"s","views":[{"id":"v1","name":"A","config":{"type":"bar"}}]}`)
	if status != http.StatusOK {
		t.Fatalf("first PUT status = %d", status)
	}
	status, _ = doJSON(t, handler, http.MethodPut, "/api/chart-views",
		`{"scope":"s","version":0,"views":[]}`)
	if status != http.StatusConflict {
		t.Fatalf("stale PUT status = %d, want 409", status)
	}
	status, _ = doJSON(t, handler, http.MethodPut, "/api/chart-views",
		`{"scope":"s","version":1,"views":[]}`)
	if status != http.StatusOK {
		t.Fatalf("current PUT status = %d", status)
	}
}

func TestChartViewsValidation(t *testing.T) {
	handler, _ := aiTestAPI(t)
	status, _ := doJSON(t, handler, http.MethodPut, "/api/chart-views",
		`{"scope":"","views":[]}`)
	if status != http.StatusBadRequest {
		t.Fatalf("empty scope status = %d, want 400", status)
	}
	status, _ = doJSON(t, handler, http.MethodPut, "/api/chart-views",
		`{"scope":"s","views":[{"id":"v1","name":"","config":{"type":"bar"}}]}`)
	if status != http.StatusBadRequest {
		t.Fatalf("empty name status = %d, want 400", status)
	}
}

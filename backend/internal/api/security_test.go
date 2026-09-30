package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func newTestAPI(t *testing.T) (*API, *config.Store) {
	t.Helper()
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	return New(store, mongoclient.NewManager(), true, "test", nil, nil), store
}

func TestReadOnlyConnectionRejectsWrites(t *testing.T) {
	api, store := newTestAPI(t)
	conn, err := store.Add(config.Connection{Name: "ro", URI: "mongodb://x", ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	handler := api.Router(nil)

	paths := []struct{ method, path string }{
		{http.MethodPost, "/api/connections/" + conn.ID + "/databases/db/collections/c/insert"},
		{http.MethodPost, "/api/connections/" + conn.ID + "/databases/db/collections/c/update"},
		{http.MethodPost, "/api/connections/" + conn.ID + "/databases/db/collections/c/delete"},
		{http.MethodPost, "/api/connections/" + conn.ID + "/databases/db/collections/c/indexes"},
		{http.MethodPost, "/api/connections/" + conn.ID + "/databases/db/collections"},
		{http.MethodDelete, "/api/connections/" + conn.ID + "/databases/db"},
	}
	for _, tc := range paths {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s %s: status = %d, want 403 (body %s)", tc.method, tc.path, rec.Code, rec.Body.String())
		}
	}
}

func TestWritableConnectionPassesReadOnlyGate(t *testing.T) {
	api, store := newTestAPI(t)
	conn, err := store.Add(config.Connection{Name: "rw", URI: "mongodb://x"})
	if err != nil {
		t.Fatal(err)
	}
	// No live client: the request must get past the read-only gate and then
	// fail with a connection error (409) rather than 403.
	handler := api.Router(nil)
	req := httptest.NewRequest(http.MethodPost,
		"/api/connections/"+conn.ID+"/databases/db/collections/c/insert",
		strings.NewReader(`{"documents":[{"a":1}]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code == http.StatusForbidden {
		t.Fatalf("writable connection rejected as read-only: %s", rec.Body.String())
	}
}

func TestSecurityHeaders(t *testing.T) {
	api, _ := newTestAPI(t)
	handler := api.Router(nil)
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	for header, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}

func TestCORSIsSameOriginByDefault(t *testing.T) {
	api, _ := newTestAPI(t)
	handler := api.Router(nil)
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("cross-origin allowed by default: %q", got)
	}
}

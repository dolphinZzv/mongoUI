package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"mongoui/internal/auth"
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
		{http.MethodPost, "/api/connections/" + conn.ID + "/databases/db/collections/c/import"},
		{http.MethodPost, "/api/connections/" + conn.ID + "/databases/db/collections/c/copy"},
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

func TestRedactConnection(t *testing.T) {
	c := config.Connection{
		URI: "mongodb://user:secret@host:27017/db",
		SSH: &config.SSHConfig{Password: "sshpass", PrivateKey: "PRIVATE", Passphrase: "pp"},
	}
	r := redactConnection(c)
	if strings.Contains(r.URI, "secret") {
		t.Fatalf("uri password leaked: %s", r.URI)
	}
	if !strings.Contains(r.URI, "xxxxxxxx") {
		t.Fatalf("uri not masked: %s", r.URI)
	}
	if r.SSH == nil || r.SSH.Password != "" || r.SSH.PrivateKey != "" || r.SSH.Passphrase != "" {
		t.Fatalf("ssh secrets leaked: %+v", r.SSH)
	}

	// A URI without credentials is returned unchanged.
	if got := redactURI("mongodb://host:27017"); got != "mongodb://host:27017" {
		t.Fatalf("no-credential uri changed: %s", got)
	}
}

func loginCookie(t *testing.T, handler http.Handler, username, password string) *http.Cookie {
	t.Helper()
	body := fmt.Sprintf(`{"username":%q,"password":%q,"method":"password"}`, username, password)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", rec.Code, rec.Body.String())
	}
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == "mongoui_session" {
			return cookie
		}
	}
	t.Fatal("login did not set a session cookie")
	return nil
}

func TestServerSettingsRequireAdmin(t *testing.T) {
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	settings := config.NewSettings(config.DefaultMCPSettings())
	manager, err := auth.New(t.TempDir(), nil, []byte("test-master-key"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetupWithPassword("admin", "admin password"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.CreatePasswordUser("viewer", auth.RoleReadWrite, "viewer password"); err != nil {
		t.Fatal(err)
	}
	handler := New(store, mongoclient.NewManager(), true, "test", nil, manager, settings).Router(nil)
	cookie := loginCookie(t, handler, "viewer", "viewer password")

	paths := []struct{ method, path, body string }{
		{http.MethodPut, "/api/update", `{"auto":false}`},
		{http.MethodPost, "/api/update/check", ""},
		{http.MethodPost, "/api/update/install", ""},
		{http.MethodPut, "/api/mcp", `{"enabled":true}`},
	}
	for _, tc := range paths {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s %s as readwrite = %d, want 403 (body %s)", tc.method, tc.path, rec.Code, rec.Body.String())
		}
	}
}

func TestPersonalAccessTokenScopesThroughAPI(t *testing.T) {
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	settings := config.NewSettings(config.DefaultMCPSettings())
	manager, err := auth.New(t.TempDir(), nil, []byte("test-master-key"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetupWithPassword("admin", "admin password"); err != nil {
		t.Fatal(err)
	}
	viewer, err := manager.CreatePasswordUser("viewer", auth.RoleReadWrite, "viewer password")
	if err != nil {
		t.Fatal(err)
	}
	readToken, _, err := manager.CreateToken(viewer.ID, "read", []string{auth.ScopeRead}, "")
	if err != nil {
		t.Fatal(err)
	}
	writeToken, _, err := manager.CreateToken(viewer.ID, "write", []string{auth.ScopeWrite}, "")
	if err != nil {
		t.Fatal(err)
	}
	handler := New(store, mongoclient.NewManager(), true, "test", nil, manager, settings).Router(nil)

	// Read tokens can list connections but must not create them.
	req := httptest.NewRequest(http.MethodGet, "/api/connections", nil)
	req.Header.Set("Authorization", "Bearer "+readToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("read token GET connections = %d: %s", rec.Code, rec.Body.String())
	}
	body := `{"name":"local","uri":"mongodb://localhost:27017"}`
	req = httptest.NewRequest(http.MethodPost, "/api/connections", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+readToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("read token create connection = %d, want 403: %s", rec.Code, rec.Body.String())
	}
	req = httptest.NewRequest(http.MethodPost, "/api/connections", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+writeToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("write token create connection = %d: %s", rec.Code, rec.Body.String())
	}
}

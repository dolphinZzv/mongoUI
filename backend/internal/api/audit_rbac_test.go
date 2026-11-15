package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"mongoui/internal/auth"
	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func TestAuditListFiltersByConnectionAccess(t *testing.T) {
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	allowed, err := store.Add(config.Connection{Name: "allowed", URI: "mongodb://x"})
	if err != nil {
		t.Fatal(err)
	}
	blocked, err := store.Add(config.Connection{Name: "blocked", URI: "mongodb://y"})
	if err != nil {
		t.Fatal(err)
	}
	manager, err := auth.New(t.TempDir(), nil, []byte("test-master-key"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetupWithPassword("admin", "admin password"); err != nil {
		t.Fatal(err)
	}
	user, err := manager.CreatePasswordUser("viewer", auth.RoleReadOnly, "viewer password")
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.UpdateUserConnections(user.ID, []string{allowed.ID}); err != nil {
		t.Fatal(err)
	}
	api := New(store, mongoclient.NewManager(), true, "test", nil, manager)
	api.audit.add(auditEntry{Actor: "alice", ConnectionID: allowed.ID, Method: "POST", Operation: "insert", Status: 200})
	api.audit.add(auditEntry{Actor: "bob", ConnectionID: blocked.ID, Method: "POST", Operation: "delete", Status: 200})
	handler := api.Router(nil)
	cookie := loginCookie(t, handler, "viewer", "viewer password")

	req := httptest.NewRequest(http.MethodGet, "/api/audit", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET audit = %d: %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data struct {
			Entries []auditEntry `json:"entries"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	seenBlocked := false
	seenAllowed := false
	for _, entry := range envelope.Data.Entries {
		if entry.ConnectionID == blocked.ID {
			seenBlocked = true
		}
		if entry.ConnectionID == allowed.ID {
			seenAllowed = true
		}
	}
	if seenBlocked || !seenAllowed {
		t.Fatalf("audit filtering failed: %#v", envelope.Data.Entries)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/audit?connectionId="+blocked.ID, nil)
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("blocked connection audit = %d, want 403", rec.Code)
	}
}

func TestAliasesFilteredByConnectionAccess(t *testing.T) {
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	allowed, _ := store.Add(config.Connection{Name: "allowed", URI: "mongodb://x"})
	blocked, _ := store.Add(config.Connection{Name: "blocked", URI: "mongodb://y"})
	settings := config.NewSettings(config.DefaultMCPSettings())
	if _, err := settings.SetAlias("database", allowed.ID, "db1", "", "allowed db"); err != nil {
		t.Fatal(err)
	}
	if _, err := settings.SetAlias("database", blocked.ID, "db2", "", "blocked db"); err != nil {
		t.Fatal(err)
	}
	manager, err := auth.New(t.TempDir(), nil, []byte("test-master-key"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetupWithPassword("admin", "admin password"); err != nil {
		t.Fatal(err)
	}
	user, err := manager.CreatePasswordUser("viewer", auth.RoleReadOnly, "viewer password")
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.UpdateUserConnections(user.ID, []string{allowed.ID}); err != nil {
		t.Fatal(err)
	}
	handler := New(store, mongoclient.NewManager(), true, "test", nil, manager, settings).Router(nil)
	cookie := loginCookie(t, handler, "viewer", "viewer password")
	req := httptest.NewRequest(http.MethodGet, "/api/aliases", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET aliases = %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !containsString(body, "allowed db") || containsString(body, "blocked db") {
		t.Fatalf("alias filtering failed: %s", body)
	}

	// A read-write user who cannot see the blocked connection must not rename
	// its alias.
	writer, err := manager.CreatePasswordUser("writer", auth.RoleReadWrite, "writer password")
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.UpdateUserConnections(writer.ID, []string{allowed.ID}); err != nil {
		t.Fatal(err)
	}
	writerCookie := loginCookie(t, handler, "writer", "writer password")
	req = httptest.NewRequest(http.MethodPatch, "/api/aliases",
		strings.NewReader(`{"kind":"database","connectionId":"`+blocked.ID+`","database":"db2","alias":"hacked"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(writerCookie)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-connection alias update = %d, want 403: %s", rec.Code, rec.Body.String())
	}
}

func containsString(haystack, needle string) bool {
	return strings.Contains(haystack, needle)
}

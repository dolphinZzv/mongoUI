package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"mongoui/internal/auth"
)

func TestAuditMiddlewareCapturesFailedLogin(t *testing.T) {
	manager, err := auth.New(t.TempDir(), nil, []byte("test-master-key"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetupWithPassword("admin", "correct horse battery"); err != nil {
		t.Fatal(err)
	}
	log := newAuditLog("")
	api := &API{auth: manager, audit: log}
	router := chi.NewRouter()
	router.Mount("/auth", api.auditMiddleware(manager.Routes()))

	req := httptest.NewRequest(http.MethodPost, "/auth/login",
		strings.NewReader(`{"username":"admin","password":"wrong","method":"password"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}

	entries := log.list("", 10)
	if len(entries) != 1 {
		t.Fatalf("expected one audit entry, got %d", len(entries))
	}
	if entries[0].Operation != "login" || entries[0].Status != http.StatusUnauthorized {
		t.Fatalf("unexpected audit entry: %#v", entries[0])
	}
	if entries[0].IP == "" {
		t.Fatal("missing failed-login IP")
	}
}

package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"mongoui/internal/mcp"
)

func TestAuditLogPersistsTail(t *testing.T) {
	dir := t.TempDir()
	log := newAuditLog(dir)
	for i := 0; i < 3; i++ {
		log.add(auditEntry{ConnectionID: "c1", Operation: "insert"})
	}
	reopened := newAuditLog(dir)
	if got := len(reopened.list("", 10)); got != 3 {
		t.Fatalf("expected 3 restored entries, got %d", got)
	}
}

func TestAuditLogRingBuffer(t *testing.T) {
	log := newAuditLog("")
	for i := 0; i < auditCapacity+50; i++ {
		log.add(auditEntry{ConnectionID: "c1", Method: "POST", Operation: "insert"})
	}
	entries := log.list("", auditCapacity)
	if len(entries) != auditCapacity {
		t.Fatalf("expected the log to cap at %d, got %d", auditCapacity, len(entries))
	}
	if filtered := log.list("other", 10); len(filtered) != 0 {
		t.Fatalf("expected no entries for another connection, got %d", len(filtered))
	}
	if filtered := log.list("c1", 5); len(filtered) != 5 {
		t.Fatalf("expected 5 entries, got %d", len(filtered))
	}
}

func TestAuditMiddlewareRecordsWrites(t *testing.T) {
	api := &API{audit: newAuditLog("")}
	router := chi.NewRouter()
	router.Use(api.auditMiddleware)
	router.Post("/connections/{id}/databases/{db}/collections/{col}/insert", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	router.Get("/connections/{id}/databases/{db}/collections/{col}/find", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/connections/c1/databases/d1/collections/x/insert", nil))

	// Reads must not be recorded.
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/connections/c1/databases/d1/collections/x/find", nil))

	entries := api.audit.list("", 10)
	if len(entries) != 1 {
		t.Fatalf("expected exactly 1 write entry, got %d", len(entries))
	}
	entry := entries[0]
	if entry.ConnectionID != "c1" || entry.Database != "d1" || entry.Collection != "x" {
		t.Fatalf("unexpected entry target: %#v", entry)
	}
	if entry.Operation != "insert" || entry.Method != http.MethodPost {
		t.Fatalf("unexpected entry operation: %#v", entry)
	}
}

func TestAuditMiddlewareRecordsFailuresAndRemoteIP(t *testing.T) {
	api := &API{audit: newAuditLog("")}
	router := chi.NewRouter()
	router.Use(api.auditMiddleware)
	router.Post("/connections/{id}/databases/{db}/collections/{col}/insert", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	req := httptest.NewRequest(http.MethodPost, "/connections/c1/databases/d1/collections/x/insert", nil)
	router.ServeHTTP(httptest.NewRecorder(), req)

	entries := api.audit.list("", 10)
	if len(entries) != 1 {
		t.Fatalf("expected failed write to be recorded, got %d", len(entries))
	}
	if entries[0].Status != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", entries[0].Status)
	}
	if entries[0].IP == "" {
		t.Fatal("missing client IP")
	}
}

func TestRecordMCPAudit(t *testing.T) {
	log := newAuditLog("")
	api := &API{audit: log}
	api.RecordMCP(mcp.AuditEvent{
		Actor: "agent", TokenID: "tok", IP: "10.0.0.1", Tool: "mongoui_delete",
		ConnectionID: "c1", Database: "d1", Collection: "x", Status: "ok",
	})
	entries := log.list("c1", 10)
	if len(entries) != 1 {
		t.Fatalf("entries = %d", len(entries))
	}
	if entries[0].Method != "MCP" || entries[0].Actor != "agent" || entries[0].Operation != "mongoui_delete" {
		t.Fatalf("entry = %#v", entries[0])
	}
}

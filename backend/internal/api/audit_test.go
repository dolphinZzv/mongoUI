package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

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

func TestAuditExport(t *testing.T) {
	log := newAuditLog("")
	log.add(auditEntry{Actor: "alice", ConnectionID: "c1", Database: "d", Collection: "c", Method: "POST", Operation: "insert", Status: 200})
	log.add(auditEntry{Actor: "bob", ConnectionID: "c2", Method: "MCP", Operation: "mongoui_delete", Status: 500, Error: "denied"})
	api := &API{audit: log}

	rec := httptest.NewRecorder()
	api.exportAudit(rec, httptest.NewRequest(http.MethodGet, "/audit/export?format=jsonl", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(rec.Header().Get("Content-Disposition"), ".jsonl") {
		t.Fatalf("disposition = %q", rec.Header().Get("Content-Disposition"))
	}
	lines := strings.Split(strings.TrimSpace(rec.Body.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("lines = %d: %s", len(lines), rec.Body.String())
	}
	if !strings.Contains(lines[0], `"operation":"mongoui_delete"`) && !strings.Contains(lines[0], `"actor":"bob"`) {
		t.Fatalf("newest entry missing: %s", lines[0])
	}

	rec = httptest.NewRecorder()
	api.exportAudit(rec, httptest.NewRequest(http.MethodGet, "/audit/export?format=csv&connectionId=c1", nil))
	if !strings.Contains(rec.Body.String(), "alice") || strings.Contains(rec.Body.String(), "bob") {
		t.Fatalf("csv filter failed: %s", rec.Body.String())
	}
}

func TestAuditCoordinationCollection(t *testing.T) {
	uri := os.Getenv("MONGOUI_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set MONGOUI_TEST_MONGO_URI to run the MongoDB integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Disconnect(context.Background())
	db := client.Database(fmt.Sprintf("mongoui_audit_%d", time.Now().UnixNano()))
	t.Cleanup(func() { _ = db.Drop(context.Background()) })
	coll := db.Collection("audit")

	a := newAuditLog("")
	a.SetCollection(coll)
	a.add(auditEntry{Actor: "alice", ConnectionID: "c1", Method: "POST", Operation: "insert", Status: 200})
	b := newAuditLog("")
	b.SetCollection(coll)
	entries := b.list("c1", 10)
	if len(entries) != 1 || entries[0].Actor != "alice" {
		t.Fatalf("coordinated entries = %#v", entries)
	}
}

func TestAuditWebhookForwarding(t *testing.T) {
	received := make(chan struct {
		body []byte
		sig  string
	}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received <- struct {
			body []byte
			sig  string
		}{body: body, sig: r.Header.Get("X-Mongoui-Signature")}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	log := newAuditLog("")
	log.SetWebhook(server.URL, "secret")
	log.add(auditEntry{Actor: "alice", ConnectionID: "c1", Method: "MCP", Operation: "mongoui_delete", Status: 200})
	select {
	case message := <-received:
		var entry auditEntry
		if err := json.Unmarshal(message.body, &entry); err != nil {
			t.Fatal(err)
		}
		if entry.Actor != "alice" || entry.Operation != "mongoui_delete" {
			t.Fatalf("forwarded entry = %#v", entry)
		}
		mac := hmac.New(sha256.New, []byte("secret"))
		_, _ = mac.Write(message.body)
		want := "sha256=" + hex.EncodeToString(mac.Sum(nil))
		if message.sig != want {
			t.Fatalf("signature = %q, want %q", message.sig, want)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("audit webhook was not called")
	}
}

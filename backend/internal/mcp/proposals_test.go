package mcp

import (
	"encoding/json"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson"

	"mongoui/internal/config"
)

func TestProposalLifecycle(t *testing.T) {
	store := newProposalStore()
	p := store.create(&Proposal{
		Tool:         "mongoui_update",
		Operation:    "update",
		ConnectionID: "c1",
		Database:     "db",
		Collection:   "col",
		Summary:      "Update 1 document",
		Count:        1,
		Matches:      1,
		Rollbackable: true,
		Preview:      json.RawMessage(`{"count":1}`),
		Args:         map[string]any{"connectionId": "c1"},
		Snapshot:     []bson.D{{{Key: "_id", Value: int32(1)}}},
	})
	if p.ID == "" || p.Status != ProposalPending {
		t.Fatalf("created proposal = %#v", p)
	}
	if err := store.approve(p.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.claimApply(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if claimed.Status != ProposalApplying || len(claimed.Snapshot) != 1 {
		t.Fatalf("claimed = %#v", claimed)
	}
	store.finishApply(p.ID, `{"modifiedCount":1}`, nil)
	applied, ok := store.get(p.ID)
	if !ok || applied.Status != ProposalApplied || applied.Result == "" {
		t.Fatalf("applied = %#v ok=%v", applied, ok)
	}
	rollback, err := store.claimRollback(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rollback.ID != p.ID {
		t.Fatalf("rollback id = %q", rollback.ID)
	}
	store.finishRollback(p.ID, nil)
	rolledBack, _ := store.get(p.ID)
	if rolledBack.Status != ProposalRolledBack {
		t.Fatalf("rollback status = %q", rolledBack.Status)
	}
}

func TestProposalRejectAndErrors(t *testing.T) {
	store := newProposalStore()
	p := store.create(&Proposal{Tool: "mongoui_delete", Operation: "delete"})
	if _, err := store.claimApply(p.ID); err == nil {
		t.Fatal("pending proposal should not be applicable")
	}
	if err := store.reject(p.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	if err := store.approve(p.ID, "admin"); err == nil {
		t.Fatal("rejected proposal should not be approvable")
	}
	if err := store.approve("missing", "admin"); err == nil {
		t.Fatal("missing proposal should error")
	}
}

func TestProposalJSONHidesInternalArgsAndSnapshot(t *testing.T) {
	p := Proposal{Args: map[string]any{"filter": map[string]any{"a": 1}}, Snapshot: []bson.D{{{Key: "_id", Value: 1}}}}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if contains(text, `"Args"`) || contains(text, `"Snapshot"`) || contains(text, `"filter"`) {
		t.Fatalf("internal fields leaked: %s", text)
	}
}

func contains(text, want string) bool { return strings.Contains(text, want) }

func TestProposalJSONOutputEmbedsPreview(t *testing.T) {
	s, _ := newTestServer(t, false)
	s.proposals.create(&Proposal{
		Tool:         "mongoui_update",
		Operation:    "update",
		ConnectionID: "c1",
		Database:     "db",
		Collection:   "col",
		Summary:      "Update 1 document",
		Preview:      json.RawMessage(`{"operation":"update","count":1}`),
		Args:         map[string]any{"filter": map[string]any{"a": 1}},
		Snapshot:     []bson.D{{{Key: "_id", Value: 1}}},
	})
	text, err := toolListProposals(s, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(text, "Snapshot") || strings.Contains(text, "Args") {
		t.Fatalf("internal proposal fields leaked: %s", text)
	}
	if !strings.Contains(text, `"preview": {`) || !strings.Contains(text, `"operation": "update"`) {
		t.Fatalf("preview was not embedded as JSON: %s", text)
	}
}

func TestProposalLocalPersistence(t *testing.T) {
	dir := t.TempDir()
	cipher, err := config.NewCipher([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	store := newProposalStore()
	store.configureLocal(dir+"/proposals.bson", cipher)
	p := store.create(&Proposal{
		Tool:         "mongoui_delete",
		Operation:    "delete",
		ConnectionID: "c1",
		Database:     "db",
		Collection:   "col",
		Summary:      "Delete 1 document",
		Count:        1,
		Matches:      1,
		Rollbackable: true,
		Preview:      json.RawMessage(`{"operation":"delete"}`),
		Args:         map[string]any{"filter": map[string]any{"a": 1}},
		Snapshot:     []bson.D{{{Key: "_id", Value: 1}}},
	})
	reloaded := newProposalStore()
	reloaded.configureLocal(dir+"/proposals.bson", cipher)
	got, ok := reloaded.get(p.ID)
	if !ok {
		t.Fatal("proposal was not restored")
	}
	if got.Status != ProposalPending || got.Operation != "delete" || len(got.Snapshot) != 1 {
		t.Fatalf("restored proposal = %#v", got)
	}
	if err := reloaded.approve(p.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	third := newProposalStore()
	third.configureLocal(dir+"/proposals.bson", cipher)
	approved, _ := third.get(p.ID)
	if approved.Status != ProposalApproved || approved.ApprovedBy != "admin" {
		t.Fatalf("approval not persisted: %#v", approved)
	}
}

type fakeAuditSink struct {
	events []AuditEvent
}

func (f *fakeAuditSink) RecordMCP(event AuditEvent) { f.events = append(f.events, event) }

func TestMCPWriteAudit(t *testing.T) {
	s, _ := newTestServer(t, false)
	sink := &fakeAuditSink{}
	s.SetAuditSink(sink)
	// A write-group tool that does not touch MongoDB still exercises the hook.
	call(t, s, "tools/call", map[string]any{
		"name":      "mongoui_list_proposals",
		"arguments": map[string]any{},
	})
	if len(sink.events) != 1 {
		t.Fatalf("audit events = %d", len(sink.events))
	}
	if sink.events[0].Tool != "mongoui_list_proposals" || sink.events[0].Status != "ok" {
		t.Fatalf("event = %#v", sink.events[0])
	}
	// Read tools are not write-audited.
	call(t, s, "tools/call", map[string]any{
		"name":      "mongoui_list_connections",
		"arguments": map[string]any{},
	})
	if len(sink.events) != 1 {
		t.Fatalf("read tool was audited: %#v", sink.events)
	}
}

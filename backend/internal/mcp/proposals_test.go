package mcp

import (
	"encoding/json"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
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

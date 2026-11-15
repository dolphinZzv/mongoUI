package automation

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func TestRunbookWriteBlockedOnReadOnlyConnection(t *testing.T) {
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	conn, err := store.Add(config.Connection{Name: "prod", URI: "mongodb://127.0.0.1:27017", ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	settings := config.NewSettings(config.DefaultMCPSettings())
	manager := New(settings, store, mongoclient.NewManager(), nil, nil)
	runbook := config.Runbook{
		ID: "r1", Name: "danger", ConnectionID: conn.ID, Database: "db",
		Script: `db.users.deleteMany({})`, TimeoutSeconds: 1,
	}
	manager.runRunbook(context.Background(), runbook)
	state := manager.RunbookStates()["r1"]
	if state.LastStatus != "error" || !strings.Contains(state.LastError, "read-only") {
		t.Fatalf("runbook state = %#v", state)
	}
}

func TestAlertPipelineTerminalWriteDetection(t *testing.T) {
	if !pipelineHasTerminalWrite([]bson.D{{{Key: "$out", Value: "copy"}}}) {
		t.Fatal("$out should be detected")
	}
	if !pipelineHasTerminalWrite([]bson.D{{{Key: "$merge", Value: bson.M{"into": "copy"}}}}) {
		t.Fatal("$merge should be detected")
	}
	if pipelineHasTerminalWrite([]bson.D{{{Key: "$match", Value: bson.M{}}}}) {
		t.Fatal("$match is not a write")
	}
}

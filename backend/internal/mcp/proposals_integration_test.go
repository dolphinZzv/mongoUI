package mcp

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func TestProposalApplyAndRollbackIntegration(t *testing.T) {
	uri := os.Getenv("MONGOUI_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set MONGOUI_TEST_MONGO_URI to run the MongoDB integration tests")
	}
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	conn, err := store.Add(config.Connection{Name: "it", URI: uri})
	if err != nil {
		t.Fatal(err)
	}
	mgr := mongoclient.NewManager()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := mgr.Connect(ctx, conn.ID, uri, nil); err != nil {
		t.Fatal(err)
	}
	defer mgr.CloseAll()
	client, err := mgr.Get(conn.ID)
	if err != nil {
		t.Fatal(err)
	}
	db := fmt.Sprintf("mongoui_prop_%d", time.Now().UnixNano())
	coll := client.Database(db).Collection("people")
	t.Cleanup(func() { _ = client.Database(db).Drop(context.Background()) })
	if _, err := coll.InsertMany(ctx, []any{
		bson.M{"name": "Alice", "status": "old"},
		bson.M{"name": "Bob", "status": "old"},
		bson.M{"name": "Carol", "status": "keep"},
	}); err != nil {
		t.Fatal(err)
	}

	s := New(store, mgr, "test", config.NewSettings(config.MCPSettings{Enabled: true, Read: true, Write: true}))
	args := map[string]any{
		"connectionId": conn.ID,
		"database":     db,
		"collection":   "people",
		"filter":       map[string]any{"status": "old"},
		"update":       map[string]any{"$set": map[string]any{"status": "new"}},
		"many":         true,
		"propose":      true,
	}
	text, err := s.createProposal("mongoui_update", args)
	if err != nil {
		t.Fatal(err)
	}
	if len(text) == 0 {
		t.Fatal("empty proposal response")
	}
	proposals := s.Proposals()
	if len(proposals) != 1 {
		t.Fatalf("proposals = %d", len(proposals))
	}
	p := proposals[0]
	if p.Status != ProposalPending || p.Matches != 2 || p.Count != 2 || !p.Rollbackable {
		t.Fatalf("proposal = %#v", p)
	}

	if _, err := s.ApplyProposal(p.ID); err == nil {
		t.Fatal("pending proposal should not apply")
	}
	if err := s.ApproveProposal(p.ID, "tester"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ApplyProposal(p.ID); err != nil {
		t.Fatal(err)
	}
	var updated []bson.M
	cursor, err := coll.Find(ctx, bson.M{"status": "new"})
	if err != nil {
		t.Fatal(err)
	}
	defer cursor.Close(ctx)
	if err := cursor.All(ctx, &updated); err != nil {
		t.Fatal(err)
	}
	if len(updated) != 2 {
		t.Fatalf("updated docs = %d, want 2", len(updated))
	}
	if err := s.RollbackProposal(p.ID); err != nil {
		t.Fatal(err)
	}
	count, err := coll.CountDocuments(ctx, bson.M{"status": "old"})
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("restored docs = %d, want 2", count)
	}
}

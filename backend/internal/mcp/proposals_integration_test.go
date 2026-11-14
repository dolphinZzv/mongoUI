package mcp

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

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

func TestProposalCoordinationPersistenceIntegration(t *testing.T) {
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
	db := client.Database(fmt.Sprintf("mongoui_props_%d", time.Now().UnixNano()))
	t.Cleanup(func() { _ = db.Drop(context.Background()) })
	coll := db.Collection("proposals")

	a := newProposalStore()
	a.setCollection(coll)
	p := a.create(&Proposal{
		Tool: "mongoui_delete", Operation: "delete", ConnectionID: "c1",
		Database: "d", Collection: "c", Summary: "Delete", Preview: []byte(`{"count":1}`),
	})
	b := newProposalStore()
	b.setCollection(coll)
	if _, ok := b.get(p.ID); !ok {
		t.Fatal("proposal not visible from second instance")
	}
	if err := b.approve(p.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	if got, _ := a.get(p.ID); got.Status != ProposalApproved {
		t.Fatalf("status from first instance = %q", got.Status)
	}
}

func TestSchemaProposalApplyAndRollbackIntegration(t *testing.T) {
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
	client, _ := mgr.Get(conn.ID)
	dbName := fmt.Sprintf("mongoui_schema_prop_%d", time.Now().UnixNano())
	db := client.Database(dbName)
	t.Cleanup(func() { _ = db.Drop(context.Background()) })
	coll := db.Collection("items")
	if _, err := coll.InsertMany(ctx, []any{bson.M{"n": 1}, bson.M{"n": 2}}); err != nil {
		t.Fatal(err)
	}
	s := New(store, mgr, "test", config.NewSettings(config.MCPSettings{Enabled: true, Read: true, Write: true}))
	base := map[string]any{"connectionId": conn.ID, "database": dbName, "collection": "items"}

	// Drop collection: snapshot and rollback.
	args := cloneMap(base)
	args["propose"] = true
	if _, err := s.createProposal("mongoui_drop_collection", args); err != nil {
		t.Fatal(err)
	}
	p := s.Proposals()[0]
	if !p.Rollbackable || p.Operation != "drop_collection" {
		t.Fatalf("drop proposal = %#v", p)
	}
	if err := s.ApproveProposal(p.ID, "tester"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ApplyProposal(p.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RollbackProposal(p.ID); err != nil {
		t.Fatal(err)
	}
	if n, err := coll.CountDocuments(ctx, bson.M{}); err != nil || n != 2 {
		t.Fatalf("restored count = %d, err=%v", n, err)
	}

	// Index create/drop proposals.
	indexArgs := cloneMap(base)
	indexArgs["keys"] = map[string]any{"n": 1}
	indexArgs["options"] = map[string]any{"name": "n_1"}
	indexArgs["propose"] = true
	if _, err := s.createProposal("mongoui_create_index", indexArgs); err != nil {
		t.Fatal(err)
	}
	create := s.Proposals()[0]
	if err := s.ApproveProposal(create.ID, "tester"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ApplyProposal(create.ID); err != nil {
		t.Fatal(err)
	}
	dropArgs := cloneMap(base)
	dropArgs["name"] = "n_1"
	dropArgs["propose"] = true
	if _, err := s.createProposal("mongoui_drop_index", dropArgs); err != nil {
		t.Fatal(err)
	}
	drop := s.Proposals()[0]
	if err := s.ApproveProposal(drop.ID, "tester"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ApplyProposal(drop.ID); err != nil {
		t.Fatal(err)
	}
	cur, err := coll.Indexes().List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var indexes []bson.M
	if err := cur.All(ctx, &indexes); err != nil {
		t.Fatal(err)
	}
	for _, index := range indexes {
		if index["name"] == "n_1" {
			t.Fatalf("index n_1 still exists")
		}
	}
}

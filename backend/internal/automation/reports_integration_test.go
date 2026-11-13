package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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

func TestBuildReportDocumentsIntegration(t *testing.T) {
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
	db := client.Database("mongoui_report_test")
	if err := db.Drop(ctx); err != nil {
		t.Fatal(err)
	}
	coll := db.Collection("events")
	if _, err := coll.InsertMany(ctx, []any{
		bson.M{"kind": "a", "n": 1},
		bson.M{"kind": "a", "n": 2},
		bson.M{"kind": "b", "n": 3},
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Drop(context.Background()) })

	docs, err := buildReportDocuments(ctx, client, config.ReportRule{
		Database:   "mongoui_report_test",
		Collection: "events",
		Filter:     `{"kind":"a"}`,
		Limit:      2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != 2 {
		t.Fatalf("filtered docs = %d, want 2", len(docs))
	}

	docs, err = buildReportDocuments(ctx, client, config.ReportRule{
		Database:   "mongoui_report_test",
		Collection: "events",
		Pipeline:   `[{"$group":{"_id":"$kind","n":{"$sum":1}}}]`,
		Limit:      10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != 2 {
		t.Fatalf("aggregated docs = %d, want 2", len(docs))
	}

	if _, err := buildReportDocuments(ctx, client, config.ReportRule{
		Database:   "mongoui_report_test",
		Collection: "events",
		Pipeline:   `[{"$out":"archive"}]`,
	}); err == nil {
		t.Fatal("$out should be rejected in reports")
	}
}

func TestRunReportDeliversWebhookIntegration(t *testing.T) {
	uri := os.Getenv("MONGOUI_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set MONGOUI_TEST_MONGO_URI to run the MongoDB integration tests")
	}
	t.Setenv("MONGOUI_ALLOW_PRIVATE_WEBHOOKS", "1")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Disconnect(context.Background())
	db := fmt.Sprintf("mongoui_report_delivery_%d", time.Now().UnixNano())
	coll := client.Database(db).Collection("events")
	if _, err := coll.InsertMany(ctx, []any{
		bson.M{"kind": "a", "n": 1},
		bson.M{"kind": "a", "n": 2},
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Database(db).Drop(context.Background()) })

	received := make(chan map[string]any, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		received <- payload
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	conn, err := store.Add(config.Connection{Name: "it", URI: uri})
	if err != nil {
		t.Fatal(err)
	}
	mgr := mongoclient.NewManager()
	if err := mgr.Connect(ctx, conn.ID, uri, nil); err != nil {
		t.Fatal(err)
	}
	defer mgr.CloseAll()
	settings := config.NewSettings(config.DefaultMCPSettings())
	manager := New(settings, store, mgr, nil, NewStore(settings, nil))
	report := config.ReportRule{
		ID: "report-1", Name: "events", ConnectionID: conn.ID, Database: db, Collection: "events",
		Filter: `{"kind":"a"}`, Limit: 10, IntervalSeconds: 60, WebhookURL: server.URL, Enabled: true,
	}
	manager.RunReportNow(ctx, report)
	select {
	case payload := <-received:
		if payload["count"].(float64) != 2 {
			t.Fatalf("webhook count = %v", payload["count"])
		}
		if docs, ok := payload["documents"].([]any); !ok || len(docs) != 2 {
			t.Fatalf("webhook documents = %#v", payload["documents"])
		}
	case <-time.After(5 * time.Second):
		t.Fatal("webhook was not delivered")
	}
	state := manager.ReportStates()["report-1"]
	if state.LastStatus != "ok" || state.LastCount != 2 {
		t.Fatalf("report state = %#v", state)
	}
}

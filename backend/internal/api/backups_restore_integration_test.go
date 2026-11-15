package api

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

func TestRestoreBackupIntegration(t *testing.T) {
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
	dbName := fmt.Sprintf("mongoui_restore_%d", time.Now().UnixNano())
	t.Cleanup(func() { _ = client.Database(dbName).Drop(context.Background()) })

	api := New(store, mgr, true, "test", nil, nil)
	defer api.backups.Close()
	task := BackupTask{ID: "manual", ConnectionID: conn.ID, Database: dbName, Collection: "items", Format: "json"}
	api.backups.mu.Lock()
	api.backups.dir = t.TempDir()
	api.backups.tasks = []BackupTask{task}
	api.backups.mu.Unlock()
	if _, err := client.Database(dbName).Collection("items").InsertOne(ctx, map[string]any{"name": "stale"}); err != nil {
		t.Fatal(err)
	}
	content := []byte(`[{"name":"Alice","n":1},{"name":"Bob","n":2}]`)
	backupPath := filepath.Join(api.backups.dir, "manual."+dbName+".items.json")
	if err := os.WriteFile(backupPath, content, 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(content)
	if err := writeBackupChecksum(backupPath, sum[:]); err != nil {
		t.Fatal(err)
	}
	handler := api.Router(nil)
	status, env := doJSON(t, handler, http.MethodPost, "/api/backups/manual/restore",
		`{"file":"manual.`+dbName+`.items.json","drop":true}`)
	if status != http.StatusOK {
		t.Fatalf("restore = %d %#v", status, env)
	}
	if got := dataOf(t, env)["insertedCount"].(float64); got != 2 {
		t.Fatalf("insertedCount = %v", got)
	}
	if got := dataOf(t, env)["verified"]; got != true {
		t.Fatalf("verified = %v, want true", got)
	}
	count, err := client.Database(dbName).Collection("items").CountDocuments(ctx, map[string]any{})
	if err != nil || count != 2 {
		t.Fatalf("restored count = %d err=%v", count, err)
	}
	if err := client.Database(dbName).Collection("items").FindOne(ctx, map[string]any{"name": "stale"}).Err(); err == nil {
		t.Fatal("drop restore left the old document behind")
	}
}

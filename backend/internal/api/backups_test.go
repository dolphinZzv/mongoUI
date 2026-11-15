package api

import (
	"crypto/sha256"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

// An empty backup list must be encoded as [] rather than null: the UI calls
// tasks.some(...) as soon as the dialog opens.
func TestListBackupsEmptyReturnsArray(t *testing.T) {
	store, err := config.NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	handler := New(store, mongoclient.NewManager(), true, "test", nil, nil).Router(nil)

	status, env := doJSON(t, handler, http.MethodGet, "/api/backups", "")
	if status != http.StatusOK {
		t.Fatalf("GET /api/backups = %d", status)
	}
	tasks, ok := dataOf(t, env)["tasks"].([]any)
	if !ok {
		t.Fatalf("tasks must be an array, got %#v", dataOf(t, env)["tasks"])
	}
	if len(tasks) != 0 {
		t.Fatalf("expected no tasks, got %#v", tasks)
	}
}

func TestBackupChecksum(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "backup.json")
	if err := os.WriteFile(path, []byte("[{\"a\":1}]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte("[{\"a\":1}]\n"))
	if err := writeBackupChecksum(path, sum[:]); err != nil {
		t.Fatal(err)
	}
	verified, err := verifyBackupChecksum(path)
	if err != nil || !verified {
		t.Fatalf("valid checksum: verified=%v err=%v", verified, err)
	}
	if err := os.WriteFile(path, []byte("[{\"a\":2}]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyBackupChecksum(path); err == nil {
		t.Fatal("modified backup passed checksum verification")
	}
}

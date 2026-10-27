package api

import (
	"net/http"
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

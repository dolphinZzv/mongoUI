package config

import (
	"path/filepath"
	"testing"
)

func TestStoreCRUD(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connections.json")
	store, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if len(store.List()) != 0 {
		t.Fatalf("expected an empty store")
	}

	created, err := store.Add(Connection{Name: "local", URI: "mongodb://127.0.0.1:27017"})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected a generated id")
	}
	if created.CreatedAt.IsZero() {
		t.Fatal("expected a creation timestamp")
	}

	if _, ok := store.Get(created.ID); !ok {
		t.Fatal("expected to find the stored connection")
	}

	updated, err := store.Update(created.ID, Connection{Name: "renamed", URI: "mongodb://example"})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Name != "renamed" {
		t.Fatalf("expected updated name, got %q", updated.Name)
	}
	if !updated.CreatedAt.Equal(created.CreatedAt) {
		t.Fatal("createdAt should be preserved on update")
	}

	// The store should survive a reload from disk.
	reloaded, err := NewStore(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	list := reloaded.List()
	if len(list) != 1 || list[0].Name != "renamed" {
		t.Fatalf("unexpected reloaded data: %+v", list)
	}

	if err := store.Delete(created.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if len(store.List()) != 0 {
		t.Fatal("expected the store to be empty after delete")
	}
	if err := store.Delete(created.ID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestStoreUpdateMissing(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "c.json"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if _, err := store.Update("nope", Connection{Name: "x"}); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

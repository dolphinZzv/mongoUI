package config

import (
	"path/filepath"
	"testing"
	"time"
)

func TestLoadSettingsDefaultsAndPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")

	s, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := s.GetMCP(); got != DefaultMCPSettings() {
		t.Fatalf("defaults = %#v, want %#v", got, DefaultMCPSettings())
	}

	want := MCPSettings{Enabled: true, Read: false, Write: true}
	if err := s.SetMCP(want); err != nil {
		t.Fatalf("set: %v", err)
	}

	reloaded, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got := reloaded.GetMCP(); got != want {
		t.Fatalf("reloaded = %#v, want %#v", got, want)
	}
}

func TestNewSettingsWithoutPath(t *testing.T) {
	s := NewSettings(MCPSettings{Enabled: false, Read: true, Write: false})
	if err := s.SetMCP(MCPSettings{Enabled: true, Read: true, Write: true}); err != nil {
		t.Fatalf("in-memory set: %v", err)
	}
	if got := s.GetMCP(); !got.Enabled || !got.Read || !got.Write {
		t.Fatalf("in-memory update lost: %#v", got)
	}
}

func TestUpdateSettingsDefaultsAndPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	s, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := s.GetUpdate(); got != DefaultUpdateSettings() {
		t.Fatalf("default update settings = %#v", got)
	}
	if err := s.SetUpdate(UpdateSettings{Auto: false, IntervalMinutes: 30}); err != nil {
		t.Fatalf("set: %v", err)
	}
	reloaded, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got := reloaded.GetUpdate(); got.Auto || got.IntervalMinutes != 30 {
		t.Fatalf("reloaded update settings = %#v", got)
	}
	if got := reloaded.GetMCP(); got != DefaultMCPSettings() {
		t.Fatalf("MCP defaults lost: %#v", got)
	}
}

func TestUpdateIntervalBounds(t *testing.T) {
	if got := (UpdateSettings{IntervalMinutes: 1}).UpdateInterval(); got != 5*time.Minute {
		t.Fatalf("interval clamped to %v, want 5m", got)
	}
	if got := (UpdateSettings{IntervalMinutes: 30}).UpdateInterval(); got != 30*time.Minute {
		t.Fatalf("interval = %v, want 30m", got)
	}
}

func TestAliasSettingsPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	s, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := s.GetAliases(); len(got.Databases) != 0 || len(got.Collections) != 0 {
		t.Fatalf("defaults = %#v, want empty aliases", got)
	}

	aliases, err := s.SetAlias("database", "c1", "orders", "", "Orders DB")
	if err != nil {
		t.Fatalf("set database alias: %v", err)
	}
	if aliases.Databases["c1::orders"] != "Orders DB" {
		t.Fatalf("database alias not returned: %#v", aliases)
	}
	aliases, err = s.SetAlias("collection", "c1", "orders", "items", "Items EN")
	if err != nil {
		t.Fatalf("set collection alias: %v", err)
	}
	if aliases.Collections["c1::orders::items"] != "Items EN" {
		t.Fatalf("collection alias not returned: %#v", aliases)
	}

	reloaded, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	got := reloaded.GetAliases()
	if got.Databases["c1::orders"] != "Orders DB" ||
		got.Collections["c1::orders::items"] != "Items EN" {
		t.Fatalf("reloaded aliases = %#v", got)
	}

	if _, err := reloaded.SetAlias("database", "c1", "orders", "", ""); err != nil {
		t.Fatalf("remove alias: %v", err)
	}
	again, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("reload after remove: %v", err)
	}
	if _, found := again.GetAliases().Databases["c1::orders"]; found {
		t.Fatalf("database alias should be removed")
	}
}

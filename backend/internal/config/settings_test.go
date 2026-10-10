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

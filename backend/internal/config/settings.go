package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// MCPSettings controls the server-side MCP capability. Tools are grouped into
// a read group and a write group; each group can be enabled independently.
//
// When MCP is enabled the read group is on by default, while the write group is
// opt-in (off by default).
type MCPSettings struct {
	Enabled bool `json:"enabled"`
	Read    bool `json:"read"`
	Write   bool `json:"write"`
}

// DefaultMCPSettings returns the safe defaults: MCP is available, but only
// read tools are exposed until the write group is explicitly enabled.
func DefaultMCPSettings() MCPSettings {
	return MCPSettings{Enabled: true, Read: true, Write: false}
}

// UpdateSettings controls the automatic self-updater.
type UpdateSettings struct {
	// Auto enables the periodic update check/install.
	Auto bool `json:"auto"`
	// IntervalMinutes is how often to check, defaulting to 10 minutes.
	IntervalMinutes int `json:"intervalMinutes"`
}

// DefaultUpdateSettings enables automatic updates every 10 minutes.
func DefaultUpdateSettings() UpdateSettings {
	return UpdateSettings{Auto: true, IntervalMinutes: 10}
}

// UpdateInterval enforces sane bounds so a misconfigured value cannot hammer
// the GitHub API (minimum 5 minutes).
func (u UpdateSettings) UpdateInterval() time.Duration {
	minutes := u.IntervalMinutes
	if minutes < 5 {
		minutes = 5
	}
	return time.Duration(minutes) * time.Minute
}

// Settings persists server-wide preferences that are not connection specific.
type Settings struct {
	mu     sync.RWMutex
	path   string
	MCP    MCPSettings    `json:"mcp"`
	Update UpdateSettings `json:"update"`
}

// NewSettings returns an in-memory settings holder. Updates are not persisted
// when no path has been configured.
func NewSettings(mcp MCPSettings) *Settings {
	return &Settings{MCP: mcp, Update: DefaultUpdateSettings()}
}

// LoadSettings loads settings from path, falling back to def when the file does
// not exist yet. The file is created lazily on the first update.
func LoadSettings(path string, def MCPSettings) (*Settings, error) {
	s := NewSettings(def)
	s.path = path

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, err
	}
	if len(data) == 0 {
		return s, nil
	}
	if err := json.Unmarshal(data, s); err != nil {
		return nil, err
	}
	return s, nil
}

// GetMCP returns a copy of the current MCP settings.
func (s *Settings) GetMCP() MCPSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.MCP
}

// SetMCP replaces the MCP settings and persists them when a path is configured.
func (s *Settings) SetMCP(mcp MCPSettings) error {
	s.mu.Lock()
	s.MCP = mcp
	s.mu.Unlock()

	if s.path == "" {
		return nil
	}
	return s.persist()
}

// GetUpdate returns a copy of the automatic-update settings.
func (s *Settings) GetUpdate() UpdateSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.Update
}

// SetUpdate replaces the automatic-update settings and persists them.
func (s *Settings) SetUpdate(update UpdateSettings) error {
	s.mu.Lock()
	s.Update = update
	s.mu.Unlock()

	if s.path == "" {
		return nil
	}
	return s.persist()
}

func (s *Settings) persist() error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

package config

import (
	"encoding/json"
	"errors"
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

// AliasSettings holds shared display aliases for databases and collections.
// Keys use the form connectionId::database and connectionId::database::collection.
type AliasSettings struct {
	Databases   map[string]string `json:"databases"`
	Collections map[string]string `json:"collections"`
}

func emptyAliases() AliasSettings {
	return AliasSettings{
		Databases:   map[string]string{},
		Collections: map[string]string{},
	}
}

// Settings persists server-wide preferences that are not connection specific.
type Settings struct {
	mu      sync.RWMutex
	path    string
	MCP     MCPSettings    `json:"mcp"`
	Update  UpdateSettings `json:"update"`
	Aliases AliasSettings  `json:"aliases"`
}

// NewSettings returns an in-memory settings holder. Updates are not persisted
// when no path has been configured.
func NewSettings(mcp MCPSettings) *Settings {
	return &Settings{
		MCP:     mcp,
		Update:  DefaultUpdateSettings(),
		Aliases: emptyAliases(),
	}
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
	if s.Aliases.Databases == nil {
		s.Aliases.Databases = map[string]string{}
	}
	if s.Aliases.Collections == nil {
		s.Aliases.Collections = map[string]string{}
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

// GetAliases returns a copy of the shared database and collection aliases.
func (s *Settings) GetAliases() AliasSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return copyAliases(s.Aliases)
}

// SetAlias adds, updates or removes (empty alias) one shared alias and persists
// the change. It returns the complete alias maps for the client.
func (s *Settings) SetAlias(kind, connectionID, database, collection, alias string) (AliasSettings, error) {
	var key string
	switch kind {
	case "database":
		if connectionID == "" || database == "" {
			return AliasSettings{}, errors.New("connectionId and database are required")
		}
		key = connectionID + "::" + database
	case "collection":
		if connectionID == "" || database == "" || collection == "" {
			return AliasSettings{}, errors.New("connectionId, database and collection are required")
		}
		key = connectionID + "::" + database + "::" + collection
	default:
		return AliasSettings{}, errors.New("alias kind must be database or collection")
	}

	s.mu.Lock()
	if s.Aliases.Databases == nil {
		s.Aliases.Databases = map[string]string{}
	}
	if s.Aliases.Collections == nil {
		s.Aliases.Collections = map[string]string{}
	}
	if kind == "database" {
		if alias == "" {
			delete(s.Aliases.Databases, key)
		} else {
			s.Aliases.Databases[key] = alias
		}
	} else {
		if alias == "" {
			delete(s.Aliases.Collections, key)
		} else {
			s.Aliases.Collections[key] = alias
		}
	}
	s.mu.Unlock()

	if s.path != "" {
		if err := s.persist(); err != nil {
			return s.GetAliases(), err
		}
	}
	return s.GetAliases(), nil
}

func copyAliases(in AliasSettings) AliasSettings {
	out := emptyAliases()
	for key, value := range in.Databases {
		out.Databases[key] = value
	}
	for key, value := range in.Collections {
		out.Collections[key] = value
	}
	return out
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

package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
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

// LocalAIUser is the AI settings key used when authentication is disabled, so a
// single-install deployment still has one BYOK profile.
const LocalAIUser = "local"

// aiUserKey normalizes an account ID for the per-user AI settings map. An empty
// ID means auth is disabled and maps to the shared local profile.
func aiUserKey(userID string) string {
	if key := strings.TrimSpace(userID); key != "" {
		return key
	}
	return LocalAIUser
}

// AISettings configures the BYOK model used by natural-language filter
// generation. Settings are stored per account; APIKey and ADKToken are
// encrypted at rest by Settings.
type AISettings struct {
	Provider    string `json:"provider"` // openai | gemini | adk
	BaseURL     string `json:"baseURL"`
	Model       string `json:"model"`
	APIMode     string `json:"apiMode"` // chat | responses (OpenAI only)
	APIKey      string `json:"apiKey"`
	ADKEndpoint string `json:"adkEndpoint"`
	ADKAppName  string `json:"adkAppName"`
	ADKUserID   string `json:"adkUserID"`
	ADKToken    string `json:"adkToken"`
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
// ChartView is a named, optionally shared chart configuration for one
// connection/database/collection scope.
type ChartView struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Config    json.RawMessage `json:"config"`
	Filter    string          `json:"filter,omitempty"`
	Pinned    bool            `json:"pinned,omitempty"`
	UpdatedAt string          `json:"updatedAt,omitempty"`
	UpdatedBy string          `json:"updatedBy,omitempty"`
}

// AlertRule is a server-side threshold alert. Secrets are encrypted at rest.
type AlertRule struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	ConnectionID    string  `json:"connectionId"`
	Database        string  `json:"database"`
	Collection      string  `json:"collection"`
	Filter          string  `json:"filter"`
	Metric          string  `json:"metric"` // count | value
	Pipeline        string  `json:"pipeline,omitempty"`
	ValueField      string  `json:"valueField,omitempty"`
	Operator        string  `json:"operator"` // above | below
	Threshold       float64 `json:"threshold"`
	IntervalSeconds int     `json:"intervalSeconds"`
	CooldownSeconds int     `json:"cooldownSeconds"`
	WebhookURL      string  `json:"webhookUrl,omitempty"`
	WebhookSecret   string  `json:"webhookSecret,omitempty"`
	EmailTo         string  `json:"emailTo,omitempty"`
	Enabled         bool    `json:"enabled"`
}

// Runbook is a scheduled mongosh-style script.
type Runbook struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	ConnectionID    string `json:"connectionId"`
	Database        string `json:"database"`
	Script          string `json:"script"`
	IntervalSeconds int    `json:"intervalSeconds"`
	TimeoutSeconds  int    `json:"timeoutSeconds"`
	Enabled         bool   `json:"enabled"`
}

// SMTPSettings configures outbound alert email. Password is encrypted at rest.
type SMTPSettings struct {
	Enabled  bool   `json:"enabled"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
	From     string `json:"from"`
}

type Settings struct {
	mu      sync.RWMutex
	path    string
	cipher  *Cipher
	MCP     MCPSettings    `json:"mcp"`
	Update  UpdateSettings `json:"update"`
	Aliases AliasSettings  `json:"aliases"`
	// AIByUser holds one BYOK profile per account ID. Auth-disabled installs
	// use the "local" key.
	AIByUser map[string]AISettings `json:"aiByUser,omitempty"`
	// LegacyAI is the pre-per-user server-wide profile. It is migrated into
	// AIByUser["local"] on load and never written back.
	LegacyAI *AISettings `json:"ai,omitempty"`
	// ChartViews holds shared chart views keyed by connection::database::collection.
	ChartViews map[string][]ChartView `json:"chartViews,omitempty"`
	// ChartViewsVersion increments on every write so clients can detect a
	// concurrent edit instead of silently overwriting each other.
	ChartViewsVersion map[string]int64 `json:"chartViewsVersion,omitempty"`
	// Alerts and Runbooks power the server-side automation scheduler.
	Alerts   map[string]AlertRule `json:"alerts,omitempty"`
	Runbooks map[string]Runbook   `json:"runbooks,omitempty"`
	SMTP     SMTPSettings         `json:"smtp,omitempty"`
}

// ErrChartViewsConflict is returned when a chart-view write is based on a stale
// version.
var ErrChartViewsConflict = errors.New("chart views were changed by someone else")

// NewSettings returns an in-memory settings holder. Updates are not persisted
// when no path has been configured.
func NewSettings(mcp MCPSettings) *Settings {
	return &Settings{
		MCP:               mcp,
		Update:            DefaultUpdateSettings(),
		Aliases:           emptyAliases(),
		AIByUser:          map[string]AISettings{},
		ChartViews:        map[string][]ChartView{},
		ChartViewsVersion: map[string]int64{},
		Alerts:            map[string]AlertRule{},
		Runbooks:          map[string]Runbook{},
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
	if s.AIByUser == nil {
		s.AIByUser = map[string]AISettings{}
	}
	if s.ChartViews == nil {
		s.ChartViews = map[string][]ChartView{}
	}
	if s.ChartViewsVersion == nil {
		s.ChartViewsVersion = map[string]int64{}
	}
	if s.Alerts == nil {
		s.Alerts = map[string]AlertRule{}
	}
	if s.Runbooks == nil {
		s.Runbooks = map[string]Runbook{}
	}
	// Older builds stored a single server-wide AI profile. Move it to the
	// local (auth-disabled) slot; authenticated installs start per user, so a
	// previously shared key is never silently handed to another account.
	if s.LegacyAI != nil {
		if _, exists := s.AIByUser[LocalAIUser]; !exists {
			s.AIByUser[LocalAIUser] = *s.LegacyAI
		}
		s.LegacyAI = nil
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

// SetCipher attaches the master-key cipher used to encrypt AI credentials.
func (s *Settings) SetCipher(cipher *Cipher) {
	s.mu.Lock()
	s.cipher = cipher
	s.mu.Unlock()
}

// GetAI returns the account's AI settings with credentials decrypted.
func (s *Settings) GetAI(userID string) (AISettings, error) {
	key := aiUserKey(userID)
	s.mu.RLock()
	ai := s.AIByUser[key]
	cipher := s.cipher
	s.mu.RUnlock()
	if cipher == nil {
		return ai, nil
	}
	var err error
	if ai.APIKey, err = cipher.Decrypt(ai.APIKey); err != nil {
		return AISettings{}, err
	}
	if ai.ADKToken, err = cipher.Decrypt(ai.ADKToken); err != nil {
		return AISettings{}, err
	}
	return ai, nil
}

// SetAI replaces one account's AI settings, encrypting credentials before they
// are persisted. An empty provider removes the profile.
func (s *Settings) SetAI(userID string, ai AISettings) error {
	key := aiUserKey(userID)
	s.mu.Lock()
	cipher := s.cipher
	if cipher != nil {
		var err error
		if ai.APIKey, err = cipher.Encrypt(ai.APIKey); err != nil {
			s.mu.Unlock()
			return err
		}
		if ai.ADKToken, err = cipher.Encrypt(ai.ADKToken); err != nil {
			s.mu.Unlock()
			return err
		}
	}
	if s.AIByUser == nil {
		s.AIByUser = map[string]AISettings{}
	}
	if s.ChartViews == nil {
		s.ChartViews = map[string][]ChartView{}
	}
	if s.ChartViewsVersion == nil {
		s.ChartViewsVersion = map[string]int64{}
	}
	if s.Alerts == nil {
		s.Alerts = map[string]AlertRule{}
	}
	if s.Runbooks == nil {
		s.Runbooks = map[string]Runbook{}
	}
	if strings.TrimSpace(ai.Provider) == "" {
		delete(s.AIByUser, key)
	} else {
		s.AIByUser[key] = ai
	}
	s.mu.Unlock()
	if s.path == "" {
		return nil
	}
	return s.persist()
}

// GetChartViews returns a copy of the shared views for one scope.
func (s *Settings) GetChartViews(scope string) []ChartView {
	s.mu.RLock()
	defer s.mu.RUnlock()
	views := s.ChartViews[scope]
	out := make([]ChartView, len(views))
	copy(out, views)
	return out
}

// ChartViewsForConnection returns every shared view whose scope belongs to the
// connection, used by the connection overview's pinned charts.
func (s *Settings) ChartViewsForConnection(connectionID string) map[string][]ChartView {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string][]ChartView{}
	prefix := connectionID + "::"
	for scope, views := range s.ChartViews {
		if strings.HasPrefix(scope, prefix) && len(views) > 0 {
			copied := make([]ChartView, len(views))
			copy(copied, views)
			out[scope] = copied
		}
	}
	return out
}

// ChartViewsRevision returns the current write version for a scope.
func (s *Settings) ChartViewsRevision(scope string) int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ChartViewsVersion[scope]
}

// SetChartViews replaces the shared views for one scope. When expected is not
// nil the write fails with ErrChartViewsConflict if another client has written
// since that version.
func (s *Settings) SetChartViews(scope string, views []ChartView, expected *int64) (int64, error) {
	s.mu.Lock()
	if s.ChartViews == nil {
		s.ChartViews = map[string][]ChartView{}
	}
	if s.ChartViewsVersion == nil {
		s.ChartViewsVersion = map[string]int64{}
	}
	if s.Alerts == nil {
		s.Alerts = map[string]AlertRule{}
	}
	if s.Runbooks == nil {
		s.Runbooks = map[string]Runbook{}
	}
	current := s.ChartViewsVersion[scope]
	if expected != nil && *expected != current {
		s.mu.Unlock()
		return current, ErrChartViewsConflict
	}
	if len(views) == 0 {
		delete(s.ChartViews, scope)
	} else {
		s.ChartViews[scope] = append([]ChartView(nil), views...)
	}
	next := current + 1
	s.ChartViewsVersion[scope] = next
	s.mu.Unlock()
	if s.path == "" {
		return next, nil
	}
	if err := s.persist(); err != nil {
		return next, err
	}
	return next, nil
}

// GetAlerts returns the alert rules with webhook secrets decrypted.
func (s *Settings) GetAlerts() ([]AlertRule, error) {
	s.mu.RLock()
	rules := make([]AlertRule, 0, len(s.Alerts))
	cipher := s.cipher
	for _, rule := range s.Alerts {
		rules = append(rules, rule)
	}
	s.mu.RUnlock()
	if cipher == nil {
		return rules, nil
	}
	for i := range rules {
		var err error
		if rules[i].WebhookSecret, err = cipher.Decrypt(rules[i].WebhookSecret); err != nil {
			return nil, err
		}
	}
	return rules, nil
}

// SetAlerts replaces the alert rules, encrypting webhook secrets.
func (s *Settings) SetAlerts(rules []AlertRule) error {
	s.mu.Lock()
	cipher := s.cipher
	next := make(map[string]AlertRule, len(rules))
	for _, rule := range rules {
		if cipher != nil {
			var err error
			if rule.WebhookSecret, err = cipher.Encrypt(rule.WebhookSecret); err != nil {
				s.mu.Unlock()
				return err
			}
		}
		next[rule.ID] = rule
	}
	s.Alerts = next
	s.mu.Unlock()
	if s.path == "" {
		return nil
	}
	return s.persist()
}

// GetRunbooks returns a copy of the scheduled runbooks.
func (s *Settings) GetRunbooks() []Runbook {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Runbook, 0, len(s.Runbooks))
	for _, runbook := range s.Runbooks {
		out = append(out, runbook)
	}
	return out
}

// SetRunbooks replaces the scheduled runbooks.
func (s *Settings) SetRunbooks(runbooks []Runbook) error {
	s.mu.Lock()
	next := make(map[string]Runbook, len(runbooks))
	for _, runbook := range runbooks {
		next[runbook.ID] = runbook
	}
	s.Runbooks = next
	s.mu.Unlock()
	if s.path == "" {
		return nil
	}
	return s.persist()
}

// GetSMTP returns SMTP settings with the password decrypted.
func (s *Settings) GetSMTP() (SMTPSettings, error) {
	s.mu.RLock()
	cfg := s.SMTP
	cipher := s.cipher
	s.mu.RUnlock()
	if cipher == nil || cfg.Password == "" {
		return cfg, nil
	}
	password, err := cipher.Decrypt(cfg.Password)
	if err != nil {
		return SMTPSettings{}, err
	}
	cfg.Password = password
	return cfg, nil
}

// SetSMTP replaces SMTP settings, encrypting the password.
func (s *Settings) SetSMTP(cfg SMTPSettings) error {
	s.mu.Lock()
	cipher := s.cipher
	if cipher != nil {
		var err error
		if cfg.Password, err = cipher.Encrypt(cfg.Password); err != nil {
			s.mu.Unlock()
			return err
		}
	}
	s.SMTP = cfg
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

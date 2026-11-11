package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
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

func TestAISettingsEncryptedPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	key := make([]byte, 32)
	cipher, err := NewCipher(key)
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	s, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	s.SetCipher(cipher)
	if err := s.SetAI("user-a", AISettings{
		Provider: "openai",
		BaseURL:  "https://api.openai.com/v1",
		Model:    "gpt-4o-mini",
		APIKey:   "secret-key",
	}); err != nil {
		t.Fatalf("set AI: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	if strings.Contains(string(raw), "secret-key") {
		t.Fatalf("API key was written in plaintext: %s", raw)
	}
	reloaded, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	reloaded.SetCipher(cipher)
	cfg, err := reloaded.GetAI("user-a")
	if err != nil {
		t.Fatalf("GetAI: %v", err)
	}
	if cfg.APIKey != "secret-key" {
		t.Fatalf("API key did not round-trip: %#v", cfg)
	}
}

func TestAISettingsPerUserIsolation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	cipher, err := NewCipher(make([]byte, 32))
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	s, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	s.SetCipher(cipher)

	if err := s.SetAI("user-a", AISettings{Provider: "openai", APIKey: "key-a"}); err != nil {
		t.Fatalf("set user-a: %v", err)
	}
	if err := s.SetAI("user-b", AISettings{Provider: "gemini", APIKey: "key-b"}); err != nil {
		t.Fatalf("set user-b: %v", err)
	}

	userA, _ := s.GetAI("user-a")
	userB, _ := s.GetAI("user-b")
	if userA.APIKey != "key-a" || userB.APIKey != "key-b" {
		t.Fatalf("profiles leaked across accounts: a=%#v b=%#v", userA, userB)
	}
	empty, err := s.GetAI("user-c")
	if err != nil {
		t.Fatalf("GetAI unknown: %v", err)
	}
	if empty.Provider != "" || empty.APIKey != "" {
		t.Fatalf("unknown account should have no profile: %#v", empty)
	}

	// Clearing the provider removes only that account's entry.
	if err := s.SetAI("user-a", AISettings{}); err != nil {
		t.Fatalf("clear user-a: %v", err)
	}
	if cleared, _ := s.GetAI("user-a"); cleared.Provider != "" {
		t.Fatalf("user-a profile should be removed: %#v", cleared)
	}
	if kept, _ := s.GetAI("user-b"); kept.Provider != "gemini" {
		t.Fatalf("user-b profile should survive: %#v", kept)
	}
}

func TestAISettingsLegacyMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	legacy := `{"ai":{"provider":"openai","apiKey":"legacy-key"}}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatalf("write legacy settings: %v", err)
	}
	s, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	cfg, err := s.GetAI(LocalAIUser)
	if err != nil {
		t.Fatalf("GetAI: %v", err)
	}
	if cfg.Provider != "openai" || cfg.APIKey != "legacy-key" {
		t.Fatalf("legacy profile was not migrated: %#v", cfg)
	}
	if _, exists := s.AIByUser["user-a"]; exists {
		t.Fatalf("legacy profile must not be shared with accounts")
	}
}

func TestChartViewsPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	s, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	scope := "conn::db::users"
	version, err := s.SetChartViews(scope, []ChartView{{
		ID:     "v1",
		Name:   "Daily users",
		Config: json.RawMessage(`{"type":"line"}`),
		Filter: "{}",
		Pinned: true,
	}}, nil)
	if err != nil {
		t.Fatalf("set views: %v", err)
	}
	if version != 1 {
		t.Fatalf("version = %d, want 1", version)
	}

	reloaded, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	views := reloaded.GetChartViews(scope)
	if len(views) != 1 || views[0].Name != "Daily users" || !views[0].Pinned {
		t.Fatalf("unexpected views: %#v", views)
	}
	if views := reloaded.GetChartViews("conn::db::other"); len(views) != 0 || views == nil {
		t.Fatalf("empty scope should return an empty slice: %#v", views)
	}
	byConnection := reloaded.ChartViewsForConnection("conn")
	if len(byConnection[scope]) != 1 {
		t.Fatalf("connection lookup missing scope: %#v", byConnection)
	}

	if _, err := reloaded.SetChartViews(scope, nil, nil); err != nil {
		t.Fatalf("clear views: %v", err)
	}
	if views := reloaded.GetChartViews(scope); len(views) != 0 {
		t.Fatalf("views should be removed: %#v", views)
	}
	stale := int64(0)
	if _, err := reloaded.SetChartViews(scope, nil, &stale); !errors.Is(err, ErrChartViewsConflict) {
		t.Fatalf("stale write error = %v, want conflict", err)
	}
}

func TestAutomationSettingsEncrypted(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	cipher, err := NewCipher(make([]byte, 32))
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	s, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	s.SetCipher(cipher)
	if err := s.SetAlerts([]AlertRule{{
		ID:            "a1",
		Name:          "High errors",
		ConnectionID:  "c",
		Database:      "db",
		Collection:    "errors",
		Metric:        "count",
		Operator:      "above",
		Threshold:     10,
		WebhookSecret: "secret",
	}}); err != nil {
		t.Fatalf("set alerts: %v", err)
	}
	if err := s.SetSMTP(SMTPSettings{Enabled: true, Host: "smtp", Password: "smtp-secret"}); err != nil {
		t.Fatalf("set smtp: %v", err)
	}
	if err := s.SetRunbooks([]Runbook{{ID: "r1", Name: "Cleanup", Script: "db.x.find({})"}}); err != nil {
		t.Fatalf("set runbooks: %v", err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if strings.Contains(string(raw), "smtp-secret") || strings.Contains(string(raw), `"secret"`) {
		t.Fatalf("secrets were stored in plaintext")
	}

	reloaded, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	reloaded.SetCipher(cipher)
	alerts, err := reloaded.GetAlerts()
	if err != nil || len(alerts) != 1 || alerts[0].WebhookSecret != "secret" {
		t.Fatalf("alert round-trip: %#v %v", alerts, err)
	}
	smtp, err := reloaded.GetSMTP()
	if err != nil || smtp.Password != "smtp-secret" {
		t.Fatalf("smtp round-trip: %#v %v", smtp, err)
	}
	if runbooks := reloaded.GetRunbooks(); len(runbooks) != 1 || runbooks[0].Name != "Cleanup" {
		t.Fatalf("runbook round-trip: %#v", runbooks)
	}
}

func TestSavedQueriesPersistAndConflict(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	s, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	scope := "conn::db::users"
	version, err := s.SetSavedQueries(scope, []SavedQuery{{
		ID:   "q1",
		Name: "Active users",
		Kind: "sql",
		Text: "SELECT * FROM users WHERE active = true",
	}}, nil)
	if err != nil {
		t.Fatalf("set queries: %v", err)
	}
	if version != 1 {
		t.Fatalf("version = %d, want 1", version)
	}
	reloaded, err := LoadSettings(path, DefaultMCPSettings())
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	queries := reloaded.GetSavedQueries(scope)
	if len(queries) != 1 || queries[0].Name != "Active users" || queries[0].Kind != "sql" {
		t.Fatalf("unexpected queries: %#v", queries)
	}
	stale := int64(0)
	if _, err := reloaded.SetSavedQueries(scope, nil, &stale); !errors.Is(err, ErrSavedQueriesConflict) {
		t.Fatalf("stale write error = %v, want conflict", err)
	}
	if _, err := reloaded.SetSavedQueries(scope, nil, nil); err != nil {
		t.Fatalf("clear queries: %v", err)
	}
	if got := reloaded.GetSavedQueries(scope); len(got) != 0 {
		t.Fatalf("queries should be removed: %#v", got)
	}
}

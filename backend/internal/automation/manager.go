// Package automation runs server-side alert rules and scheduled runbooks.
package automation

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/smtp"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
	"mongoui/internal/mongoscript"
)

const tickInterval = 15 * time.Second

// AlertState is the in-memory runtime state of one alert rule.
type AlertState struct {
	LastRun       string `json:"lastRun,omitempty"`
	LastValue     string `json:"lastValue,omitempty"`
	LastError     string `json:"lastError,omitempty"`
	LastTriggered string `json:"lastTriggered,omitempty"`
	Triggered     bool   `json:"triggered"`
}

// RunbookRun is one execution entry in the runbook history.
type RunbookRun struct {
	At         string `json:"at"`
	Status     string `json:"status"`
	DurationMs int64  `json:"durationMs"`
	Error      string `json:"error,omitempty"`
}

// RunbookState is the in-memory runtime state of one runbook.
type RunbookState struct {
	LastRun    string       `json:"lastRun,omitempty"`
	LastStatus string       `json:"lastStatus,omitempty"`
	LastError  string       `json:"lastError,omitempty"`
	History    []RunbookRun `json:"history,omitempty"`
}

// Manager evaluates alert rules and runbooks on a fixed tick.
type Manager struct {
	settings *config.Settings
	store    *config.Store
	mgr      *mongoclient.Manager
	client   *http.Client

	mu       sync.Mutex
	lastRun  map[string]time.Time
	alerts   map[string]AlertState
	runbooks map[string]RunbookState
	running  map[string]bool
}

func New(settings *config.Settings, store *config.Store, mgr *mongoclient.Manager) *Manager {
	return &Manager{
		settings: settings,
		store:    store,
		mgr:      mgr,
		client:   &http.Client{Timeout: 10 * time.Second},
		lastRun:  map[string]time.Time{},
		alerts:   map[string]AlertState{},
		runbooks: map[string]RunbookState{},
		running:  map[string]bool{},
	}
}

func (m *Manager) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()
		m.tick(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.tick(ctx)
			}
		}
	}()
}

func (m *Manager) tick(ctx context.Context) {
	alerts, err := m.settings.GetAlerts()
	if err == nil {
		for _, rule := range alerts {
			if !rule.Enabled || rule.IntervalSeconds <= 0 {
				continue
			}
			if !m.due("a:"+rule.ID, rule.IntervalSeconds) {
				continue
			}
			m.claim("a:" + rule.ID)
			go m.runAlert(ctx, rule)
		}
	}
	for _, runbook := range m.settings.GetRunbooks() {
		if !runbook.Enabled || runbook.IntervalSeconds <= 0 {
			continue
		}
		if !m.due("r:"+runbook.ID, runbook.IntervalSeconds) {
			continue
		}
		m.claim("r:" + runbook.ID)
		go m.runRunbook(ctx, runbook)
	}
}

func (m *Manager) due(id string, interval int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.running[id] {
		return false
	}
	last, ok := m.lastRun[id]
	return !ok || time.Since(last) >= time.Duration(interval)*time.Second
}

func (m *Manager) claim(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.lastRun[id] = time.Now()
	m.running[id] = true
}

func (m *Manager) release(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.running, id)
}

// AlertStates returns a snapshot for the API.
func (m *Manager) AlertStates() map[string]AlertState {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]AlertState, len(m.alerts))
	for key, value := range m.alerts {
		out[key] = value
	}
	return out
}

// RunbookStates returns a snapshot for the API.
func (m *Manager) RunbookStates() map[string]RunbookState {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]RunbookState, len(m.runbooks))
	for key, value := range m.runbooks {
		value.History = append([]RunbookRun(nil), value.History...)
		out[key] = value
	}
	return out
}

func (m *Manager) clientFor(ctx context.Context, connectionID string) (*mongo.Client, error) {
	if client, err := m.mgr.Get(connectionID); err == nil {
		return client, nil
	}
	connection, ok := m.store.Get(connectionID)
	if !ok {
		return nil, fmt.Errorf("connection %q not found", connectionID)
	}
	if err := m.mgr.Connect(ctx, connection.ID, connection.URI, connection.SSH); err != nil {
		return nil, err
	}
	return m.mgr.Get(connectionID)
}

func (m *Manager) runAlert(ctx context.Context, rule config.AlertRule) {
	defer m.release("a:" + rule.ID)
	state := AlertState{LastRun: time.Now().UTC().Format(time.RFC3339)}
	client, err := m.clientFor(ctx, rule.ConnectionID)
	if err != nil {
		state.LastError = err.Error()
		m.setAlertState(rule.ID, state)
		return
	}
	runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	value, err := evaluateAlert(runCtx, client, rule)
	if err != nil {
		state.LastError = err.Error()
		m.setAlertState(rule.ID, state)
		return
	}
	state.LastValue = fmt.Sprintf("%.6g", value)
	triggered := (rule.Operator == "below" && value < rule.Threshold) ||
		(rule.Operator != "below" && value > rule.Threshold)
	state.Triggered = triggered
	if !triggered {
		m.setAlertState(rule.ID, state)
		return
	}

	m.mu.Lock()
	previous := m.alerts[rule.ID]
	m.mu.Unlock()
	cooldown := time.Duration(rule.CooldownSeconds) * time.Second
	shouldNotify := !previous.Triggered
	if previous.LastTriggered != "" && cooldown > 0 {
		if at, err := time.Parse(time.RFC3339, previous.LastTriggered); err == nil {
			shouldNotify = shouldNotify || time.Since(at) >= cooldown
		}
	}
	if shouldNotify {
		state.LastTriggered = state.LastRun
		if err := m.notify(ctx, rule, value); err != nil {
			state.LastError = err.Error()
		}
	} else {
		state.LastTriggered = previous.LastTriggered
	}
	m.setAlertState(rule.ID, state)
}

func (m *Manager) setAlertState(id string, state AlertState) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alerts[id] = state
}

func evaluateAlert(ctx context.Context, client *mongo.Client, rule config.AlertRule) (float64, error) {
	coll := client.Database(rule.Database).Collection(rule.Collection)
	filter := bson.D{}
	if strings.TrimSpace(rule.Filter) != "" {
		if err := bson.UnmarshalExtJSON([]byte(rule.Filter), false, &filter); err != nil {
			return 0, fmt.Errorf("invalid filter: %w", err)
		}
	}
	if rule.Metric == "value" {
		stages := []bson.D{}
		if strings.TrimSpace(rule.Pipeline) != "" {
			if err := bson.UnmarshalExtJSON([]byte(rule.Pipeline), false, &stages); err != nil {
				return 0, fmt.Errorf("invalid pipeline: %w", err)
			}
		}
		cursor, err := coll.Aggregate(ctx, mongo.Pipeline(stages))
		if err != nil {
			return 0, err
		}
		defer cursor.Close(ctx)
		var doc bson.M
		if !cursor.Next(ctx) {
			return 0, errors.New("aggregation returned no rows")
		}
		if err := cursor.Decode(&doc); err != nil {
			return 0, err
		}
		value, ok := numericValue(doc[rule.ValueField])
		if !ok {
			return 0, fmt.Errorf("value field %q is not numeric", rule.ValueField)
		}
		return value, nil
	}
	count, err := coll.CountDocuments(ctx, filter)
	if err != nil {
		return 0, err
	}
	return float64(count), nil
}

func numericValue(value any) (float64, bool) {
	switch v := value.(type) {
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case float64:
		return v, true
	case float32:
		return float64(v), true
	default:
		return 0, false
	}
}

func (m *Manager) notify(ctx context.Context, rule config.AlertRule, value float64) error {
	payload := map[string]any{
		"rule":       rule.Name,
		"id":         rule.ID,
		"connection": rule.ConnectionID,
		"database":   rule.Database,
		"collection": rule.Collection,
		"value":      value,
		"operator":   rule.Operator,
		"threshold":  rule.Threshold,
		"at":         time.Now().UTC().Format(time.RFC3339),
	}
	var failures []string
	if strings.TrimSpace(rule.WebhookURL) != "" {
		if err := m.sendWebhook(ctx, rule, payload); err != nil {
			failures = append(failures, "webhook: "+err.Error())
		}
	}
	if strings.TrimSpace(rule.EmailTo) != "" {
		if err := m.sendEmail(ctx, rule, value); err != nil {
			failures = append(failures, "email: "+err.Error())
		}
	}
	if len(failures) > 0 {
		return errors.New(strings.Join(failures, "; "))
	}
	return nil
}

func (m *Manager) sendWebhook(ctx context.Context, rule config.AlertRule, payload map[string]any) error {
	if err := validateWebhookURL(rule.WebhookURL); err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	for attempt := 0; attempt < 3; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, rule.WebhookURL, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if rule.WebhookSecret != "" {
			mac := hmac.New(sha256.New, []byte(rule.WebhookSecret))
			mac.Write(body)
			req.Header.Set("X-Mongoui-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
		}
		resp, err := m.client.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
			err = fmt.Errorf("webhook returned HTTP %d", resp.StatusCode)
		}
		if attempt == 2 {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(1<<attempt) * time.Second):
		}
	}
	return nil
}

func (m *Manager) sendEmail(ctx context.Context, rule config.AlertRule, value float64) error {
	cfg, err := m.settings.GetSMTP()
	if err != nil {
		return err
	}
	if !cfg.Enabled || cfg.Host == "" || cfg.From == "" {
		return errors.New("SMTP is not configured")
	}
	port := cfg.Port
	if port == 0 {
		port = 587
	}
	subject := fmt.Sprintf("[MongoUI] %s triggered", rule.Name)
	body := fmt.Sprintf(
		"Alert %s triggered.\n\nConnection: %s\nDatabase: %s\nCollection: %s\nValue: %.6g\nThreshold: %s %.6g\n",
		rule.Name, rule.ConnectionID, rule.Database, rule.Collection, value, rule.Operator, rule.Threshold,
	)
	message := []byte("From: " + cfg.From + "\r\n" +
		"To: " + rule.EmailTo + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" + body)
	addr := fmt.Sprintf("%s:%d", cfg.Host, port)
	var auth smtp.Auth
	if cfg.Username != "" {
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	}
	done := make(chan error, 1)
	recipients := []string{}
	for _, recipient := range strings.Split(rule.EmailTo, ",") {
		if trimmed := strings.TrimSpace(recipient); trimmed != "" {
			recipients = append(recipients, trimmed)
		}
	}
	if len(recipients) == 0 {
		return errors.New("no email recipients")
	}
	go func() { done <- smtp.SendMail(addr, auth, cfg.From, recipients, message) }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		return err
	}
}

func validateWebhookURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("webhook URL must use http or https")
	}
	if os.Getenv("MONGOUI_ALLOW_PRIVATE_WEBHOOKS") == "1" {
		return nil
	}
	host := parsed.Hostname()
	if host == "" {
		return errors.New("webhook URL has no host")
	}
	addresses, err := net.LookupIP(host)
	if err != nil {
		return err
	}
	for _, address := range addresses {
		if address.IsLoopback() || address.IsPrivate() || address.IsLinkLocalUnicast() || address.IsUnspecified() {
			return errors.New("webhook URL resolves to a private address")
		}
	}
	return nil
}

func (m *Manager) runRunbook(ctx context.Context, runbook config.Runbook) {
	defer m.release("r:" + runbook.ID)
	start := time.Now()
	status := RunbookRun{At: start.UTC().Format(time.RFC3339), Status: "success"}
	client, err := m.clientFor(ctx, runbook.ConnectionID)
	if err != nil {
		status.Status = "error"
		status.Error = err.Error()
		m.appendRunbook(runbook.ID, status)
		return
	}
	timeout := time.Duration(runbook.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	stmts, err := mongoscript.Parse(runbook.Script)
	if err != nil {
		status.Status = "error"
		status.Error = err.Error()
		m.appendRunbook(runbook.ID, status)
		return
	}
	runner := &mongoscript.Runner{
		DB:           client.Database(runbook.Database),
		DefaultLimit: 100,
		MaxLimit:     1000,
	}
	results := runner.Run(runCtx, stmts)
	for _, result := range results {
		if !result.OK {
			status.Status = "error"
			status.Error = result.Error
			break
		}
	}
	status.DurationMs = time.Since(start).Milliseconds()
	m.appendRunbook(runbook.ID, status)
}

func (m *Manager) appendRunbook(id string, run RunbookRun) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state := m.runbooks[id]
	state.LastRun = run.At
	state.LastStatus = run.Status
	state.LastError = run.Error
	state.History = append([]RunbookRun{run}, state.History...)
	if len(state.History) > 20 {
		state.History = state.History[:20]
	}
	m.runbooks[id] = state
}

// RunRunbook executes a runbook immediately (manual run).
func (m *Manager) RunRunbook(ctx context.Context, runbook config.Runbook) {
	m.claim("r:" + runbook.ID)
	m.runRunbook(ctx, runbook)
}

// Test sends a test notification for a rule without evaluating it.
func (m *Manager) Test(ctx context.Context, rule config.AlertRule) error {
	return m.notify(ctx, rule, rule.Threshold)
}

// LogStartup records the automation manager start for operators.
func LogStartup() { log.Printf("automation scheduler started (tick %s)", tickInterval) }

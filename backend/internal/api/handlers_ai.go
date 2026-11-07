package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"mongoui/internal/ai"
	"mongoui/internal/config"
)

const (
	aiMaxDescription = 4000
	aiMaxFields      = 200
	aiFilterTimeout  = 90 * time.Second
)

type aiSettingsView struct {
	Provider    string `json:"provider"`
	BaseURL     string `json:"baseURL"`
	Model       string `json:"model"`
	APIMode     string `json:"apiMode"`
	ADKEndpoint string `json:"adkEndpoint"`
	ADKAppName  string `json:"adkAppName"`
	ADKUserID   string `json:"adkUserID"`
	HasAPIKey   bool   `json:"hasAPIKey"`
	HasADKToken bool   `json:"hasADKToken"`
}

type aiSettingsInput struct {
	Provider      string  `json:"provider"`
	BaseURL       string  `json:"baseURL"`
	Model         string  `json:"model"`
	APIMode       string  `json:"apiMode"`
	APIKey        *string `json:"apiKey"`
	ClearAPIKey   bool    `json:"clearAPIKey"`
	ADKEndpoint   string  `json:"adkEndpoint"`
	ADKAppName    string  `json:"adkAppName"`
	ADKUserID     string  `json:"adkUserID"`
	ADKToken      *string `json:"adkToken"`
	ClearADKToken bool    `json:"clearADKToken"`
}

func (a *API) getAISettings(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	cfg, err := a.settings.GetAI()
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, aiView(cfg))
}

func (a *API) updateAISettings(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	var in aiSettingsInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	current, err := a.settings.GetAI()
	if err != nil {
		serverError(w, err)
		return
	}

	current.Provider = strings.ToLower(strings.TrimSpace(in.Provider))
	current.BaseURL = strings.TrimSpace(in.BaseURL)
	current.Model = strings.TrimSpace(in.Model)
	current.APIMode = strings.ToLower(strings.TrimSpace(in.APIMode))
	current.ADKEndpoint = strings.TrimSpace(in.ADKEndpoint)
	current.ADKAppName = strings.TrimSpace(in.ADKAppName)
	current.ADKUserID = strings.TrimSpace(in.ADKUserID)

	if in.ClearAPIKey {
		current.APIKey = ""
	} else if in.APIKey != nil && strings.TrimSpace(*in.APIKey) != "" {
		current.APIKey = strings.TrimSpace(*in.APIKey)
	}
	if in.ClearADKToken {
		current.ADKToken = ""
	} else if in.ADKToken != nil && strings.TrimSpace(*in.ADKToken) != "" {
		current.ADKToken = strings.TrimSpace(*in.ADKToken)
	}

	cfg, err := normalizeAI(current)
	if err != nil {
		badRequest(w, err)
		return
	}
	if err := a.settings.SetAI(cfg); err != nil {
		serverError(w, err)
		return
	}
	ok(w, aiView(cfg))
}

type aiFilterInput struct {
	Description  string            `json:"description"`
	ConnectionID string            `json:"connectionId"`
	Database     string            `json:"database"`
	Collection   string            `json:"collection"`
	Fields       []string          `json:"fields"`
	FieldTypes   map[string]string `json:"fieldTypes"`
}

type aiFilterOutput struct {
	Filter   map[string]any `json:"filter"`
	Provider string         `json:"provider"`
	Model    string         `json:"model"`
}

// generateAIFilter converts a natural-language description into a Mongo find
// filter using the server's BYOK provider. It never returns the API key.
func (a *API) generateAIFilter(w http.ResponseWriter, r *http.Request) {
	var in aiFilterInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	in.Description = strings.TrimSpace(in.Description)
	if in.Description == "" {
		badRequest(w, errors.New("description is required"))
		return
	}
	if utf8.RuneCountInString(in.Description) > aiMaxDescription {
		badRequest(w, fmt.Errorf("description must be at most %d characters", aiMaxDescription))
		return
	}
	if len(in.Fields) > aiMaxFields {
		in.Fields = in.Fields[:aiMaxFields]
	}
	for i, field := range in.Fields {
		in.Fields[i] = strings.TrimSpace(field)
	}

	cfg, err := a.settings.GetAI()
	if err != nil {
		serverError(w, err)
		return
	}
	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
	if provider == "" {
		fail(w, http.StatusServiceUnavailable, errors.New("AI is not configured; add a BYOK provider in Settings → AI"))
		return
	}
	if (provider == "openai" || provider == "gemini") && cfg.APIKey == "" {
		fail(w, http.StatusServiceUnavailable, errors.New("AI API key is not configured; add it in Settings → AI"))
		return
	}
	if provider == "adk" && cfg.ADKEndpoint == "" {
		fail(w, http.StatusServiceUnavailable, errors.New("Google ADK endpoint is not configured; add it in Settings → AI"))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), aiFilterTimeout)
	defer cancel()
	raw, err := ai.GenerateFilter(ctx, cfg, buildAIFilterPrompt(in))
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	filter, err := extractFilterJSON(raw)
	if err != nil {
		fail(w, http.StatusBadGateway, fmt.Errorf("AI returned an invalid filter: %w", err))
		return
	}
	ok(w, aiFilterOutput{
		Filter:   filter,
		Provider: cfg.Provider,
		Model:    cfg.Model,
	})
}

func aiView(cfg config.AISettings) aiSettingsView {
	return aiSettingsView{
		Provider:    cfg.Provider,
		BaseURL:     cfg.BaseURL,
		Model:       cfg.Model,
		APIMode:     cfg.APIMode,
		ADKEndpoint: cfg.ADKEndpoint,
		ADKAppName:  cfg.ADKAppName,
		ADKUserID:   cfg.ADKUserID,
		HasAPIKey:   cfg.APIKey != "",
		HasADKToken: cfg.ADKToken != "",
	}
}

func normalizeAI(cfg config.AISettings) (config.AISettings, error) {
	cfg.Provider = strings.ToLower(strings.TrimSpace(cfg.Provider))
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	cfg.Model = strings.TrimSpace(cfg.Model)
	cfg.APIMode = strings.ToLower(strings.TrimSpace(cfg.APIMode))
	cfg.ADKEndpoint = strings.TrimRight(strings.TrimSpace(cfg.ADKEndpoint), "/")
	cfg.ADKAppName = strings.TrimSpace(cfg.ADKAppName)
	cfg.ADKUserID = strings.TrimSpace(cfg.ADKUserID)

	switch cfg.Provider {
	case "openai":
		if cfg.APIMode == "" {
			cfg.APIMode = "chat"
		}
		if cfg.APIMode != "chat" && cfg.APIMode != "responses" {
			return config.AISettings{}, errors.New("OpenAI API mode must be chat or responses")
		}
		if cfg.BaseURL == "" {
			cfg.BaseURL = "https://api.openai.com/v1"
		}
		if cfg.Model == "" {
			cfg.Model = "gpt-4o-mini"
		}
		if err := validHTTPURL(cfg.BaseURL); err != nil {
			return config.AISettings{}, fmt.Errorf("invalid OpenAI base URL: %w", err)
		}
	case "gemini":
		cfg.APIMode = ""
		if cfg.BaseURL == "" {
			cfg.BaseURL = "https://generativelanguage.googleapis.com/v1beta"
		}
		if cfg.Model == "" {
			cfg.Model = "gemini-2.5-flash"
		}
		if err := validHTTPURL(cfg.BaseURL); err != nil {
			return config.AISettings{}, fmt.Errorf("invalid Gemini base URL: %w", err)
		}
	case "adk":
		cfg.APIMode = ""
		if cfg.ADKEndpoint == "" {
			return config.AISettings{}, errors.New("Google ADK endpoint is required")
		}
		if err := validHTTPURL(cfg.ADKEndpoint); err != nil {
			return config.AISettings{}, fmt.Errorf("invalid ADK endpoint: %w", err)
		}
		if cfg.ADKAppName == "" {
			cfg.ADKAppName = "mongoui"
		}
		if cfg.ADKUserID == "" {
			cfg.ADKUserID = "mongoui"
		}
	default:
		return config.AISettings{}, errors.New("provider must be openai, gemini or adk")
	}
	return cfg, nil
}

func validHTTPURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil {
		return err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("URL must start with http:// or https://")
	}
	if parsed.Host == "" {
		return errors.New("URL must include a host")
	}
	return nil
}

func buildAIFilterPrompt(in aiFilterInput) string {
	var b strings.Builder
	b.WriteString("You translate natural-language requests into MongoDB find filters.\n")
	b.WriteString("Return exactly one valid JSON object and nothing else. No markdown fences, comments or explanations.\n")
	b.WriteString("Use only the supplied field names and MongoDB query operators. ")
	b.WriteString("For case-insensitive text matching use {\"$regex\":\"...\",\"$options\":\"i\"}. ")
	b.WriteString("For date/time comparisons use MongoDB Extended JSON values such as {\"$date\":\"2026-01-01T00:00:00Z\"}. ")
	b.WriteString("If the request is ambiguous, choose the most reasonable filter using the available fields.\n")
	b.WriteString("Today (UTC): " + time.Now().UTC().Format("2006-01-02") + "\n")
	if in.ConnectionID != "" || in.Database != "" || in.Collection != "" {
		b.WriteString("Target: " + in.Database + "." + in.Collection + "\n")
	}
	b.WriteString("Available fields and BSON types:\n")
	if len(in.Fields) == 0 {
		b.WriteString("- (none supplied; infer field names carefully)\n")
	}
	for _, field := range in.Fields {
		if field == "" {
			continue
		}
		kind := strings.TrimSpace(in.FieldTypes[field])
		if kind == "" {
			kind = "unknown"
		}
		b.WriteString(fmt.Sprintf("- %s (%s)\n", field, kind))
	}
	b.WriteString("User request:\n")
	b.WriteString(in.Description)
	b.WriteString("\n")
	return b.String()
}

func extractFilterJSON(raw string) (map[string]any, error) {
	text := strings.TrimSpace(raw)
	if strings.HasPrefix(text, "```") {
		if newline := strings.IndexByte(text, '\n'); newline >= 0 {
			text = text[newline+1:]
		}
		text = strings.TrimSuffix(strings.TrimSpace(text), "```")
	}
	start := strings.IndexByte(text, '{')
	end := strings.LastIndexByte(text, '}')
	if start < 0 || end < start {
		return nil, errors.New("response does not contain a JSON object")
	}
	candidate := text[start : end+1]
	if len(candidate) > 100*1024 {
		return nil, errors.New("filter JSON is too large")
	}
	var filter map[string]any
	if err := json.Unmarshal([]byte(candidate), &filter); err != nil {
		return nil, err
	}
	if filter == nil {
		return nil, errors.New("filter must be a JSON object")
	}
	return filter, nil
}

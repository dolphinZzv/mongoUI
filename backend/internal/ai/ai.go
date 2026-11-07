// Package ai calls the configured BYOK model provider and returns the model's
// raw text response. Provider-specific request/response shapes live here so the
// HTTP handlers stay small and testable.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"mongoui/internal/config"
)

const (
	defaultOpenAIBaseURL = "https://api.openai.com/v1"
	defaultOpenAIModel   = "gpt-4o-mini"
	defaultGeminiBaseURL = "https://generativelanguage.googleapis.com/v1beta"
	defaultGeminiModel   = "gemini-2.5-flash"
)

var httpClient = &http.Client{Timeout: 90 * time.Second}

// GenerateFilter asks the configured provider to turn prompt into a MongoDB
// filter. The response is returned as raw model text; the caller validates and
// extracts the JSON object.
func GenerateFilter(ctx context.Context, cfg config.AISettings, prompt string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Provider)) {
	case "openai":
		return generateOpenAI(ctx, cfg, prompt)
	case "gemini":
		return generateGemini(ctx, cfg, prompt)
	case "adk":
		return generateADK(ctx, cfg, prompt)
	case "":
		return "", errors.New("AI provider is not configured")
	default:
		return "", fmt.Errorf("unsupported AI provider %q", cfg.Provider)
	}
}

func generateOpenAI(ctx context.Context, cfg config.AISettings, prompt string) (string, error) {
	if strings.EqualFold(strings.TrimSpace(cfg.APIMode), "responses") {
		return generateOpenAIResponses(ctx, cfg, prompt)
	}

	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if base == "" {
		base = defaultOpenAIBaseURL
	}
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = defaultOpenAIModel
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return "", errors.New("OpenAI API key is not configured")
	}

	body := map[string]any{
		"model":       model,
		"temperature": 0,
		"messages": []map[string]string{
			{"role": "system", "content": "You convert natural-language requests into MongoDB JSON filters. Return only the JSON object, with no markdown fences or prose."},
			{"role": "user", "content": prompt},
		},
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := postJSON(ctx, base+"/chat/completions", map[string]string{
		"Authorization": "Bearer " + strings.TrimSpace(cfg.APIKey),
	}, body, &out); err != nil {
		return "", err
	}
	if len(out.Choices) == 0 {
		return "", errors.New("OpenAI returned no choices")
	}
	return out.Choices[0].Message.Content, nil
}

func generateOpenAIResponses(ctx context.Context, cfg config.AISettings, prompt string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if base == "" {
		base = defaultOpenAIBaseURL
	}
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = defaultOpenAIModel
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return "", errors.New("OpenAI API key is not configured")
	}

	body := map[string]any{
		"model":        model,
		"instructions": "You convert natural-language requests into MongoDB JSON filters. Return only the JSON object, with no markdown fences or prose.",
		"input":        prompt,
		"store":        false,
	}
	var out struct {
		OutputText string `json:"output_text"`
		Output     []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := postJSON(ctx, base+"/responses", map[string]string{
		"Authorization": "Bearer " + strings.TrimSpace(cfg.APIKey),
	}, body, &out); err != nil {
		return "", err
	}
	if strings.TrimSpace(out.OutputText) != "" {
		return out.OutputText, nil
	}
	var text strings.Builder
	for _, item := range out.Output {
		for _, part := range item.Content {
			if part.Text != "" {
				text.WriteString(part.Text)
			}
		}
	}
	if strings.TrimSpace(text.String()) == "" {
		return "", errors.New("OpenAI Responses API returned no text")
	}
	return text.String(), nil
}

func generateGemini(ctx context.Context, cfg config.AISettings, prompt string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if base == "" {
		base = defaultGeminiBaseURL
	}
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = defaultGeminiModel
	}
	model = strings.TrimPrefix(model, "models/")
	if strings.TrimSpace(cfg.APIKey) == "" {
		return "", errors.New("Gemini API key is not configured")
	}

	endpoint := fmt.Sprintf("%s/models/%s:generateContent?key=%s",
		base, url.PathEscape(model), url.QueryEscape(strings.TrimSpace(cfg.APIKey)))
	body := map[string]any{
		"systemInstruction": map[string]any{
			"parts": []map[string]string{{"text": "You convert natural-language requests into MongoDB JSON filters. Return only the JSON object, with no markdown fences or prose."}},
		},
		"contents": []map[string]any{
			{"role": "user", "parts": []map[string]string{{"text": prompt}}},
		},
		"generationConfig": map[string]any{
			"temperature":      0,
			"responseMimeType": "application/json",
		},
	}
	var out struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := postJSON(ctx, endpoint, nil, body, &out); err != nil {
		return "", err
	}
	if len(out.Candidates) == 0 {
		return "", errors.New("Gemini returned no candidates")
	}
	var text strings.Builder
	for _, part := range out.Candidates[0].Content.Parts {
		text.WriteString(part.Text)
	}
	return text.String(), nil
}

func generateADK(ctx context.Context, cfg config.AISettings, prompt string) (string, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(cfg.ADKEndpoint), "/")
	if endpoint == "" {
		return "", errors.New("Google ADK endpoint is not configured")
	}
	app := strings.TrimSpace(cfg.ADKAppName)
	if app == "" {
		app = "mongoui"
	}
	user := strings.TrimSpace(cfg.ADKUserID)
	if user == "" {
		user = "mongoui"
	}
	headers := map[string]string{}
	if token := strings.TrimSpace(cfg.ADKToken); token != "" {
		headers["Authorization"] = "Bearer " + token
	}

	sessionID := uuid.NewString()
	sessionsPath := fmt.Sprintf("%s/apps/%s/users/%s/sessions",
		endpoint, url.PathEscape(app), url.PathEscape(user))
	sessionURL := sessionsPath + "/" + url.PathEscape(sessionID)
	if err := postJSON(ctx, sessionsPath, headers, map[string]string{"session_id": sessionID}, nil); err != nil {
		return "", fmt.Errorf("create ADK session: %w", err)
	}
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		deleteRequest(cleanupCtx, sessionURL, headers)
	}()

	body := map[string]any{
		"app_name":   app,
		"user_id":    user,
		"session_id": sessionID,
		"new_message": map[string]any{
			"role":  "user",
			"parts": []map[string]string{{"text": prompt}},
		},
	}
	var events []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	}
	if err := postJSON(ctx, endpoint+"/run", headers, body, &events); err != nil {
		return "", err
	}
	var text string
	for _, event := range events {
		var parts strings.Builder
		for _, part := range event.Content.Parts {
			parts.WriteString(part.Text)
		}
		if candidate := strings.TrimSpace(parts.String()); candidate != "" {
			text = candidate
		}
	}
	if text == "" {
		return "", errors.New("ADK returned no text response")
	}
	return text, nil
}

func postJSON(ctx context.Context, endpoint string, headers map[string]string, body any, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	return doRequest(req, out)
}

func deleteRequest(ctx context.Context, endpoint string, headers map[string]string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := httpClient.Do(req)
	if err == nil {
		_ = resp.Body.Close()
	}
}

func doRequest(req *http.Request, out any) error {
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail := strings.TrimSpace(string(data))
		if len(detail) > 2000 {
			detail = detail[:2000] + "…"
		}
		return fmt.Errorf("AI provider returned HTTP %d: %s", resp.StatusCode, detail)
	}
	if out == nil || len(data) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("decode AI response: %w", err)
	}
	return nil
}

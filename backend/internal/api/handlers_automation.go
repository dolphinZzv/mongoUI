package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson"

	"mongoui/internal/config"
)

type alertView struct {
	config.AlertRule
	WebhookSecret    string `json:"webhookSecret,omitempty"`
	HasWebhookSecret bool   `json:"hasWebhookSecret"`
}

type alertsInput struct {
	Rules []config.AlertRule `json:"rules"`
}

type runbooksInput struct {
	Runbooks []config.Runbook `json:"runbooks"`
}

type smtpView struct {
	Enabled     bool   `json:"enabled"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	From        string `json:"from"`
	HasPassword bool   `json:"hasPassword"`
}

type smtpInput struct {
	Enabled  bool   `json:"enabled"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	From     string `json:"from"`
}

func (a *API) getAlerts(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	rules, err := a.automationStore.GetAlerts()
	if err != nil {
		serverError(w, err)
		return
	}
	views := make([]alertView, 0, len(rules))
	for _, rule := range rules {
		hasSecret := rule.WebhookSecret != ""
		rule.WebhookSecret = ""
		views = append(views, alertView{
			AlertRule:        rule,
			HasWebhookSecret: hasSecret,
		})
	}
	statuses := map[string]any{}
	if a.automation != nil {
		statuses = toAnyMap(a.automation.AlertStates())
	}
	ok(w, map[string]any{"rules": views, "statuses": statuses})
}

func (a *API) updateAlerts(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	var in alertsInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	existing, _ := a.automationStore.GetAlerts()
	secrets := map[string]string{}
	for _, rule := range existing {
		secrets[rule.ID] = rule.WebhookSecret
	}
	rules := make([]config.AlertRule, 0, len(in.Rules))
	for _, rule := range in.Rules {
		rule.ID = strings.TrimSpace(rule.ID)
		rule.Name = strings.TrimSpace(rule.Name)
		rule.ConnectionID = strings.TrimSpace(rule.ConnectionID)
		rule.Database = strings.TrimSpace(rule.Database)
		rule.Collection = strings.TrimSpace(rule.Collection)
		rule.Filter = strings.TrimSpace(rule.Filter)
		rule.Pipeline = strings.TrimSpace(rule.Pipeline)
		rule.ValueField = strings.TrimSpace(rule.ValueField)
		rule.WebhookURL = strings.TrimSpace(rule.WebhookURL)
		rule.EmailTo = strings.TrimSpace(rule.EmailTo)
		if rule.ID == "" || rule.Name == "" || rule.ConnectionID == "" || rule.Database == "" || rule.Collection == "" {
			badRequest(w, errors.New("alert id, name, connection, database and collection are required"))
			return
		}
		if _, ok := a.store.Get(rule.ConnectionID); !ok {
			badRequest(w, errors.New("alert connection does not exist"))
			return
		}
		if rule.Metric != "value" {
			rule.Metric = "count"
		}
		if rule.Operator != "below" {
			rule.Operator = "above"
		}
		if rule.IntervalSeconds < 5 {
			rule.IntervalSeconds = 5
		}
		if rule.IntervalSeconds > 86400 {
			rule.IntervalSeconds = 86400
		}
		if rule.CooldownSeconds < 0 {
			rule.CooldownSeconds = 0
		}
		if rule.Filter != "" {
			var filter bson.D
			if err := bson.UnmarshalExtJSON([]byte(rule.Filter), false, &filter); err != nil {
				badRequest(w, errors.New("invalid alert filter: "+err.Error()))
				return
			}
		}
		if rule.Pipeline != "" {
			var pipeline []bson.D
			if err := bson.UnmarshalExtJSON([]byte(rule.Pipeline), false, &pipeline); err != nil {
				badRequest(w, errors.New("invalid alert pipeline: "+err.Error()))
				return
			}
		}
		if rule.WebhookSecret == "" {
			rule.WebhookSecret = secrets[rule.ID]
		}
		rules = append(rules, rule)
	}
	if err := a.automationStore.SetAlerts(rules); err != nil {
		serverError(w, err)
		return
	}
	a.getAlerts(w, r)
}

func (a *API) testAlert(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	var rule config.AlertRule
	if err := decodeJSON(r, &rule); err != nil {
		badRequest(w, err)
		return
	}
	if a.automation == nil {
		serverError(w, errors.New("automation is not running"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if err := a.automation.Test(ctx, rule); err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	ok(w, map[string]any{"sent": true})
}

func (a *API) getRunbooks(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	statuses := map[string]any{}
	if a.automation != nil {
		statuses = toAnyMap(a.automation.RunbookStates())
	}
	ok(w, map[string]any{"runbooks": a.automationStore.GetRunbooks(), "statuses": statuses})
}

func (a *API) updateRunbooks(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	var in runbooksInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	runbooks := make([]config.Runbook, 0, len(in.Runbooks))
	for _, runbook := range in.Runbooks {
		runbook.ID = strings.TrimSpace(runbook.ID)
		runbook.Name = strings.TrimSpace(runbook.Name)
		runbook.ConnectionID = strings.TrimSpace(runbook.ConnectionID)
		runbook.Database = strings.TrimSpace(runbook.Database)
		if runbook.ID == "" || runbook.Name == "" || runbook.ConnectionID == "" || runbook.Database == "" {
			badRequest(w, errors.New("runbook id, name, connection and database are required"))
			return
		}
		if _, ok := a.store.Get(runbook.ConnectionID); !ok {
			badRequest(w, errors.New("runbook connection does not exist"))
			return
		}
		if strings.TrimSpace(runbook.Script) == "" {
			badRequest(w, errors.New("runbook script is required"))
			return
		}
		if runbook.IntervalSeconds < 5 {
			runbook.IntervalSeconds = 5
		}
		if runbook.IntervalSeconds > 86400 {
			runbook.IntervalSeconds = 86400
		}
		if runbook.TimeoutSeconds <= 0 {
			runbook.TimeoutSeconds = 60
		}
		if runbook.TimeoutSeconds > 3600 {
			runbook.TimeoutSeconds = 3600
		}
		runbooks = append(runbooks, runbook)
	}
	if err := a.automationStore.SetRunbooks(runbooks); err != nil {
		serverError(w, err)
		return
	}
	a.getRunbooks(w, r)
}

func (a *API) runRunbookNow(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	if a.automation == nil {
		serverError(w, errors.New("automation is not running"))
		return
	}
	id := chi.URLParam(r, "id")
	for _, runbook := range a.automationStore.GetRunbooks() {
		if runbook.ID == id {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
				defer cancel()
				a.automation.RunRunbook(ctx, runbook)
			}()
			ok(w, map[string]any{"started": true})
			return
		}
	}
	fail(w, http.StatusNotFound, errors.New("runbook not found"))
}

func (a *API) getSMTP(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	cfg, err := a.automationStore.GetSMTP()
	if err != nil {
		serverError(w, err)
		return
	}
	ok(w, smtpView{
		Enabled:     cfg.Enabled,
		Host:        cfg.Host,
		Port:        cfg.Port,
		Username:    cfg.Username,
		From:        cfg.From,
		HasPassword: cfg.Password != "",
	})
}

func (a *API) updateSMTP(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	var in smtpInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	current, _ := a.automationStore.GetSMTP()
	password := strings.TrimSpace(in.Password)
	if password == "" {
		password = current.Password
	}
	cfg := config.SMTPSettings{
		Enabled:  in.Enabled,
		Host:     strings.TrimSpace(in.Host),
		Port:     in.Port,
		Username: strings.TrimSpace(in.Username),
		Password: password,
		From:     strings.TrimSpace(in.From),
	}
	if cfg.Port <= 0 {
		cfg.Port = 587
	}
	if err := a.automationStore.SetSMTP(cfg); err != nil {
		serverError(w, err)
		return
	}
	a.getSMTP(w, r)
}

func toAnyMap[T any](in map[string]T) map[string]any {
	out := make(map[string]any, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

type reportsInput struct {
	Reports []config.ReportRule `json:"reports"`
}

type reportView struct {
	config.ReportRule
	WebhookSecret    string `json:"webhookSecret,omitempty"`
	HasWebhookSecret bool   `json:"hasWebhookSecret"`
}

func (a *API) getReports(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	reports, err := a.automationStore.GetReports()
	if err != nil {
		serverError(w, err)
		return
	}
	views := make([]reportView, 0, len(reports))
	for _, report := range reports {
		hasSecret := report.WebhookSecret != ""
		report.WebhookSecret = ""
		views = append(views, reportView{ReportRule: report, HasWebhookSecret: hasSecret})
	}
	statuses := map[string]any{}
	if a.automation != nil {
		statuses = toAnyMap(a.automation.ReportStates())
	}
	ok(w, map[string]any{"reports": views, "statuses": statuses})
}

func (a *API) updateReports(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	var in reportsInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	existing, _ := a.automationStore.GetReports()
	secrets := map[string]string{}
	for _, report := range existing {
		secrets[report.ID] = report.WebhookSecret
	}
	reports := make([]config.ReportRule, 0, len(in.Reports))
	for _, report := range in.Reports {
		report.ID = strings.TrimSpace(report.ID)
		report.Name = strings.TrimSpace(report.Name)
		report.ConnectionID = strings.TrimSpace(report.ConnectionID)
		report.Database = strings.TrimSpace(report.Database)
		report.Collection = strings.TrimSpace(report.Collection)
		report.Filter = strings.TrimSpace(report.Filter)
		report.Pipeline = strings.TrimSpace(report.Pipeline)
		report.WebhookURL = strings.TrimSpace(report.WebhookURL)
		report.EmailTo = strings.TrimSpace(report.EmailTo)
		if report.ID == "" || report.Name == "" || report.ConnectionID == "" || report.Database == "" || report.Collection == "" {
			badRequest(w, errors.New("report id, name, connection, database and collection are required"))
			return
		}
		if _, ok := a.store.Get(report.ConnectionID); !ok {
			badRequest(w, errors.New("report connection does not exist"))
			return
		}
		if report.IntervalSeconds < 5 {
			report.IntervalSeconds = 5
		}
		if report.IntervalSeconds > 86400 {
			report.IntervalSeconds = 86400
		}
		if report.Limit <= 0 {
			report.Limit = 50
		}
		if report.Limit > 500 {
			report.Limit = 500
		}
		if report.Filter != "" {
			var filter bson.D
			if err := bson.UnmarshalExtJSON([]byte(report.Filter), false, &filter); err != nil {
				badRequest(w, errors.New("invalid report filter: "+err.Error()))
				return
			}
		}
		if report.Pipeline != "" {
			var pipeline []bson.D
			if err := bson.UnmarshalExtJSON([]byte(report.Pipeline), false, &pipeline); err != nil {
				badRequest(w, errors.New("invalid report pipeline: "+err.Error()))
				return
			}
			for _, stage := range pipeline {
				for _, e := range stage {
					if e.Key == "$out" || e.Key == "$merge" {
						badRequest(w, errors.New("reports are read-only; $out and $merge are not allowed"))
						return
					}
				}
			}
		}
		if report.WebhookURL == "" && report.EmailTo == "" {
			badRequest(w, errors.New("report needs a webhookUrl or emailTo destination"))
			return
		}
		if report.WebhookSecret == "" {
			report.WebhookSecret = secrets[report.ID]
		}
		reports = append(reports, report)
	}
	if err := a.automationStore.SetReports(reports); err != nil {
		serverError(w, err)
		return
	}
	a.getReports(w, r)
}

func (a *API) runReportNow(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	if a.automation == nil {
		serverError(w, errors.New("automation is not running"))
		return
	}
	id := chi.URLParam(r, "id")
	reports, err := a.automationStore.GetReports()
	if err != nil {
		serverError(w, err)
		return
	}
	for _, report := range reports {
		if report.ID != id {
			continue
		}
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
			defer cancel()
			a.automation.RunReportNow(ctx, report)
		}()
		ok(w, map[string]any{"started": true})
		return
	}
	fail(w, http.StatusNotFound, errors.New("report not found"))
}

package api

import (
	"net/http"

	"mongoui/internal/catchreport"
)

type telemetrySettingsInput struct {
	ErrorTracking *bool `json:"errorTracking"`
}

// getTelemetrySettings exposes the error-tracking switch to the SPA. The
// endpoint is public so the login screen can decide whether to load Catch.
func (a *API) getTelemetrySettings(w http.ResponseWriter, _ *http.Request) {
	ok(w, map[string]any{"errorTracking": a.settings.GetErrorTracking()})
}

func (a *API) updateTelemetrySettings(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	var in telemetrySettingsInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	if in.ErrorTracking == nil {
		badRequest(w, errTelemetryMissing)
		return
	}
	if err := a.settings.SetErrorTracking(*in.ErrorTracking); err != nil {
		serverError(w, err)
		return
	}
	catchreport.SetEnabled(*in.ErrorTracking)
	ok(w, map[string]any{"errorTracking": a.settings.GetErrorTracking()})
}

var errTelemetryMissing = &telemetryError{"errorTracking is required"}

type telemetryError struct{ message string }

func (e *telemetryError) Error() string { return e.message }

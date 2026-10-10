package api

import (
	"errors"
	"net/http"
)

// updateSettingsInput is a partial update of the self-updater preferences.
type updateSettingsInput struct {
	Auto            *bool `json:"auto"`
	IntervalMinutes *int  `json:"intervalMinutes"`
}

// getUpdate returns the auto-update settings plus the current updater status.
func (a *API) getUpdate(w http.ResponseWriter, _ *http.Request) {
	payload := map[string]any{"settings": a.settings.GetUpdate()}
	if a.updater != nil {
		payload["status"] = a.updater.Status()
	} else {
		payload["status"] = nil
	}
	ok(w, payload)
}

// updateUpdateSettings toggles automatic updates and the check interval.
func (a *API) updateUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var in updateSettingsInput
	if err := decodeJSON(r, &in); err != nil {
		badRequest(w, err)
		return
	}
	cfg := a.settings.GetUpdate()
	if in.Auto != nil {
		cfg.Auto = *in.Auto
	}
	if in.IntervalMinutes != nil {
		if *in.IntervalMinutes < 5 {
			badRequest(w, errors.New("intervalMinutes must be at least 5"))
			return
		}
		cfg.IntervalMinutes = *in.IntervalMinutes
	}
	if err := a.settings.SetUpdate(cfg); err != nil {
		serverError(w, err)
		return
	}
	ok(w, cfg)
}

// checkUpdate looks for a newer release without installing it.
func (a *API) checkUpdate(w http.ResponseWriter, _ *http.Request) {
	if a.updater == nil {
		fail(w, http.StatusServiceUnavailable, errors.New("self-updater is not available"))
		return
	}
	status, err := a.updater.Check()
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	ok(w, status)
}

// installUpdate checks for a newer release and installs it when available.
func (a *API) installUpdate(w http.ResponseWriter, _ *http.Request) {
	if a.updater == nil {
		fail(w, http.StatusServiceUnavailable, errors.New("self-updater is not available"))
		return
	}
	status, err := a.updater.Update()
	if err != nil {
		fail(w, http.StatusBadGateway, err)
		return
	}
	ok(w, status)
}

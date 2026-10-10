// Package autoupdate periodically checks GitHub Releases for a newer mongoui
// binary and installs it. It is driven by the persisted update settings so the
// user can disable it (or change the interval) from the UI.
//
// The updater replaces the on-disk binary but does not restart the running
// process: it reports RestartRequired so the UI can ask the user to restart.
package autoupdate

import (
	"bytes"
	"log"
	"sync"
	"time"

	"mongoui/internal/config"
	"mongoui/internal/update"
)

// Status is a snapshot of the updater state, exposed over the API.
type Status struct {
	Current          string    `json:"current"`
	Latest           string    `json:"latest"`
	UpdateAvailable  bool      `json:"updateAvailable"`
	InstalledVersion string    `json:"installedVersion"`
	RestartRequired  bool      `json:"restartRequired"`
	LastChecked      time.Time `json:"lastChecked"`
	LastError        string    `json:"lastError,omitempty"`
}

// Updater checks for and installs newer releases on a schedule.
type Updater struct {
	version  string
	repo     string
	settings *config.Settings

	mu     sync.Mutex
	status Status

	stop chan struct{}
	wg   sync.WaitGroup
}

// New creates an updater for the given running version and repository.
func New(version, repo string, settings *config.Settings) *Updater {
	if repo == "" {
		repo = update.DefaultRepo
	}
	u := &Updater{version: version, repo: repo, settings: settings}
	u.status.Current = version
	return u
}

// Start launches the background loop. It is a no-op if already running.
func (u *Updater) Start() {
	u.mu.Lock()
	if u.stop != nil {
		u.mu.Unlock()
		return
	}
	u.stop = make(chan struct{})
	stop := u.stop
	u.mu.Unlock()

	u.wg.Add(1)
	go u.loop(stop)
}

// Stop terminates the background loop. It waits briefly for an in-flight check
// so shutdown is not blocked by a slow network call.
func (u *Updater) Stop() {
	u.mu.Lock()
	stop := u.stop
	u.stop = nil
	u.mu.Unlock()
	if stop == nil {
		return
	}
	close(stop)
	done := make(chan struct{})
	go func() {
		u.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
	}
}

// Status returns a copy of the current updater state.
func (u *Updater) Status() Status {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.status
}

func (u *Updater) loop(stop chan struct{}) {
	defer u.wg.Done()
	for {
		cfg := u.settings.GetUpdate()
		if cfg.Auto {
			if _, err := u.Update(); err != nil {
				log.Printf("autoupdate: %v", err)
			}
		}
		timer := time.NewTimer(cfg.UpdateInterval())
		select {
		case <-stop:
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

// Check looks for a newer version without installing it.
func (u *Updater) Check() (Status, error) {
	latest, err := update.LatestTag(u.repo)
	if err != nil {
		u.setError(err)
		return u.Status(), err
	}
	u.setCheck(latest)
	return u.Status(), err
}

// Update checks for a newer version and installs it when available. It is safe
// to call concurrently with the background loop.
func (u *Updater) Update() (Status, error) {
	latest, err := update.LatestTag(u.repo)
	if err != nil {
		u.setError(err)
		return u.Status(), err
	}
	u.setCheck(latest)
	if !update.Newer(latest, u.version) {
		return u.Status(), nil
	}

	var buf bytes.Buffer
	if err := update.Install(u.repo, u.version, latest, &buf); err != nil {
		u.setError(err)
		return u.Status(), err
	}

	u.mu.Lock()
	u.status.Latest = latest
	u.status.UpdateAvailable = false
	u.status.InstalledVersion = latest
	u.status.RestartRequired = true
	u.status.LastError = ""
	u.mu.Unlock()
	return u.Status(), nil
}

func (u *Updater) setCheck(latest string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.status.Latest = latest
	u.status.UpdateAvailable = update.Newer(latest, u.version)
	u.status.LastChecked = time.Now().UTC()
	u.status.LastError = ""
}

func (u *Updater) setError(err error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.status.LastChecked = time.Now().UTC()
	u.status.LastError = err.Error()
}

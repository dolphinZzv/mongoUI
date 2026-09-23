//go:build windows

// Package daemon exposes a no-op implementation on Windows so the rest of the
// program keeps compiling. Background services on Windows should be managed
// with the Service Control Manager, NSSM or the Task Scheduler.
package daemon

import "errors"

// Config holds the paths used by the daemon.
type Config struct {
	PidFile string
	LogFile string
}

var errUnsupported = errors.New("daemon mode is not supported on Windows; use a service manager such as NSSM or the Task Scheduler")

// IsChild always reports false on Windows.
func IsChild() bool { return false }

// Start is not supported on Windows.
func Start(Config) error { return errUnsupported }

// WritePid is a no-op on Windows.
func WritePid(string) error { return nil }

// RemovePid is a no-op on Windows.
func RemovePid(string) {}

// Status is not supported on Windows.
func Status(string) (int, bool, error) { return 0, false, errUnsupported }

// Stop is not supported on Windows.
func Stop(string) error { return errUnsupported }

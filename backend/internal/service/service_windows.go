//go:build windows

package service

import "errors"

// DefaultDataDir is the conventional Windows data directory.
func DefaultDataDir() string { return `C:\ProgramData\mongoui` }

var errUnsupported = errors.New("system service installation is not supported on Windows yet; use NSSM or the Windows Service Control Manager")

func Install(Config) error   { return errUnsupported }
func Uninstall(string) error { return errUnsupported }
func Start(string) error     { return errUnsupported }
func Stop(string) error      { return errUnsupported }
func Restart(string) error   { return errUnsupported }
func Status(string) error    { return errUnsupported }
func Logs(string, int) error { return errUnsupported }

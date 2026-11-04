//go:build !linux && !darwin && !windows

package service

import "errors"

// DefaultDataDir is the conventional Unix state directory.
func DefaultDataDir() string { return "/var/lib/mongoui" }

var errUnsupported = errors.New("system service installation is not supported on this operating system; use Docker or `mongoui -daemon`")

func Install(Config) error   { return errUnsupported }
func Uninstall(string) error { return errUnsupported }
func Start(string) error     { return errUnsupported }
func Stop(string) error      { return errUnsupported }
func Restart(string) error   { return errUnsupported }
func Status(string) error    { return errUnsupported }
func Logs(string, int) error { return errUnsupported }

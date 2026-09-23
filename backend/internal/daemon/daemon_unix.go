//go:build !windows

// Package daemon provides a small Unix daemon helper: it can re-exec the
// current binary detached from the controlling terminal, track a pid file and
// stop a running instance.
package daemon

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const envMarker = "MONGOUI_DAEMON_CHILD"

// Config holds the paths used by the daemon.
type Config struct {
	PidFile string
	LogFile string
}

// IsChild reports whether the current process is the detached child.
func IsChild() bool { return os.Getenv(envMarker) == "1" }

// Start re-executes the current binary with setsid so it survives the parent
// shell exiting. It returns after the child has been spawned.
func Start(cfg Config) error {
	if cfg.PidFile == "" {
		return errors.New("pid file path is required")
	}
	if pid, running, _ := Status(cfg.PidFile); running {
		return fmt.Errorf("mongoui is already running (pid %d)", pid)
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot resolve executable: %w", err)
	}

	logFile, err := os.OpenFile(cfg.LogFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("cannot open log file: %w", err)
	}
	defer logFile.Close()

	child := exec.Command(exe, os.Args[1:]...)
	child.Env = append(os.Environ(), envMarker+"=1")
	child.Stdin = nil
	child.Stdout = logFile
	child.Stderr = logFile
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	if err := child.Start(); err != nil {
		return fmt.Errorf("cannot start daemon: %w", err)
	}

	fmt.Printf("mongoui started in background (pid %d)\n", child.Process.Pid)
	fmt.Printf("  pid file: %s\n", cfg.PidFile)
	fmt.Printf("  log file: %s\n", cfg.LogFile)
	return nil
}

// WritePid stores the current process id.
func WritePid(pidFile string) error {
	return os.WriteFile(pidFile, []byte(strconv.Itoa(os.Getpid())+"\n"), 0o644)
}

// RemovePid deletes the pid file, ignoring errors.
func RemovePid(pidFile string) {
	if pidFile != "" {
		_ = os.Remove(pidFile)
	}
}

func readPid(pidFile string) (int, error) {
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return 0, err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return 0, fmt.Errorf("invalid pid file %s", pidFile)
	}
	return pid, nil
}

// Status reports the pid stored in pidFile and whether that process is alive.
func Status(pidFile string) (int, bool, error) {
	pid, err := readPid(pidFile)
	if err != nil {
		return 0, false, err
	}
	err = syscall.Kill(pid, 0)
	switch {
	case err == nil, errors.Is(err, syscall.EPERM):
		return pid, true, nil
	case errors.Is(err, syscall.ESRCH):
		return pid, false, nil
	default:
		return pid, false, err
	}
}

// Stop sends SIGTERM to the daemon and waits for it to exit.
func Stop(pidFile string) error {
	pid, err := readPid(pidFile)
	if err != nil {
		return fmt.Errorf("mongoui is not running (%w)", err)
	}
	if err := syscall.Kill(pid, syscall.SIGTERM); err != nil {
		if errors.Is(err, syscall.ESRCH) {
			RemovePid(pidFile)
			return fmt.Errorf("process %d is not running; removed stale pid file", pid)
		}
		return err
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(pid, 0); err != nil {
			RemovePid(pidFile)
			fmt.Printf("mongoui stopped (pid %d)\n", pid)
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("timed out waiting for pid %d to exit", pid)
}

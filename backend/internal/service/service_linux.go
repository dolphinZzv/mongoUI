//go:build linux

package service

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// DefaultDataDir is the state directory used by the installed systemd unit.
func DefaultDataDir() string { return "/var/lib/mongoui" }

func unitPath(name string) string {
	return filepath.Join("/etc/systemd/system", name+".service")
}

func requireSystemctl() error {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return errors.New("systemd is not available on this host; use Docker or `mongoui -daemon` instead")
	}
	return nil
}

// Install writes and enables a systemd unit. It requires root because the unit
// lives under /etc/systemd/system and the service normally runs as root so the
// built-in updater can replace its own binary.
func Install(cfg Config) error {
	cfg = withDefaults(cfg)
	if err := ValidateName(cfg.Name); err != nil {
		return err
	}
	if os.Geteuid() != 0 {
		return errors.New("installing a system service requires root; re-run with sudo")
	}
	if err := requireSystemctl(); err != nil {
		return err
	}
	if cfg.ExecPath == "" {
		return errors.New("cannot determine the mongoui executable path")
	}
	if err := ensureDataDir(cfg.DataDir, cfg.User); err != nil {
		return err
	}
	if err := writeFileAtomic(unitPath(cfg.Name), []byte(renderSystemdUnit(cfg)), 0o644); err != nil {
		return fmt.Errorf("write systemd unit: %w", err)
	}
	if err := run("systemctl", "daemon-reload"); err != nil {
		return err
	}
	if err := run("systemctl", "enable", cfg.Name); err != nil {
		return err
	}
	if cfg.NoStart {
		return nil
	}
	return run("systemctl", "restart", cfg.Name)
}

// Uninstall stops, disables and removes the unit. The data directory is kept.
func Uninstall(name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	if os.Geteuid() != 0 {
		return errors.New("removing a system service requires root; re-run with sudo")
	}
	if err := requireSystemctl(); err != nil {
		return err
	}
	runIgnore("systemctl", "disable", "--now", name)
	if err := os.Remove(unitPath(name)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove systemd unit: %w", err)
	}
	return run("systemctl", "daemon-reload")
}

func Start(name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	if err := requireSystemctl(); err != nil {
		return err
	}
	return run("systemctl", "start", name)
}

func Stop(name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	if err := requireSystemctl(); err != nil {
		return err
	}
	return run("systemctl", "stop", name)
}

func Restart(name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	if err := requireSystemctl(); err != nil {
		return err
	}
	return run("systemctl", "restart", name)
}

func Status(name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	if err := requireSystemctl(); err != nil {
		return err
	}
	return run("systemctl", "status", "--no-pager", "--full", name)
}

func Logs(name string, lines int) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	if _, err := exec.LookPath("journalctl"); err != nil {
		return errors.New("journalctl is not available on this host")
	}
	if lines <= 0 || lines > 10000 {
		lines = 100
	}
	return run("journalctl", "-u", name, "-n", strconv.Itoa(lines), "--no-pager", "-l")
}

func renderSystemdUnit(cfg Config) string {
	cfg = withDefaults(cfg)
	var b strings.Builder
	b.WriteString("[Unit]\n")
	b.WriteString("Description=MongoUI MongoDB admin console\n")
	b.WriteString("After=network-online.target\n")
	b.WriteString("Wants=network-online.target\n\n")
	b.WriteString("[Service]\n")
	b.WriteString("Type=simple\n")
	if cfg.User != "" {
		fmt.Fprintf(&b, "User=%s\n", cfg.User)
	}
	fmt.Fprintf(&b, "ExecStart=%s -addr %s -data %s\n",
		systemdArg(cfg.ExecPath), systemdArg(cfg.Addr), systemdArg(cfg.DataDir))
	// The updater replaces the on-disk binary; this tells the process to exit
	// cleanly afterwards so systemd can start the new version.
	b.WriteString("Environment=MONGOUI_RESTART_AFTER_UPDATE=1\n")
	if cfg.Home != "" {
		fmt.Fprintf(&b, "Environment=HOME=%s\n", systemdArg(cfg.Home))
	}
	if cfg.Repo != "" {
		fmt.Fprintf(&b, "Environment=MONGOUI_REPO=%s\n", systemdArg(cfg.Repo))
	}
	b.WriteString("Restart=always\n")
	b.WriteString("RestartSec=5\n")
	b.WriteString("KillSignal=SIGTERM\n")
	b.WriteString("TimeoutStopSec=20\n\n")
	b.WriteString("[Install]\n")
	b.WriteString("WantedBy=multi-user.target\n")
	return b.String()
}

func systemdArg(value string) string {
	if value == "" {
		return `""`
	}
	if !strings.ContainsAny(value, " \t\n\"'\\") {
		return value
	}
	replacer := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`, "\t", `\t`)
	return `"` + replacer.Replace(value) + `"`
}

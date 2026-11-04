//go:build darwin

package service

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// DefaultDataDir is the state directory used by the installed LaunchDaemon.
func DefaultDataDir() string { return "/usr/local/var/mongoui" }

func label(name string) string { return "com.mongoui." + name }

func plistPath(name string) string {
	return filepath.Join("/Library/LaunchDaemons", label(name)+".plist")
}

func requireLaunchctl() error {
	if _, err := exec.LookPath("launchctl"); err != nil {
		return errors.New("launchctl is not available on this host")
	}
	return nil
}

// Install writes a launchd LaunchDaemon. It requires root because the plist
// lives in /Library/LaunchDaemons and the daemon normally runs as root so the
// built-in updater can replace its own binary.
func Install(cfg Config) error {
	cfg = withDefaults(cfg)
	if err := ValidateName(cfg.Name); err != nil {
		return err
	}
	if os.Geteuid() != 0 {
		return errors.New("installing a system service requires root; re-run with sudo")
	}
	if err := requireLaunchctl(); err != nil {
		return err
	}
	if cfg.ExecPath == "" {
		return errors.New("cannot determine the mongoui executable path")
	}
	if err := ensureDataDir(cfg.DataDir, cfg.User); err != nil {
		return err
	}
	path := plistPath(cfg.Name)
	if err := writeFileAtomic(path, []byte(renderLaunchdPlist(cfg)), 0o644); err != nil {
		return fmt.Errorf("write launchd plist: %w", err)
	}
	if cfg.NoStart {
		return nil
	}
	// Replace any previous version of the job before bootstrapping the new one.
	_ = runSilently("launchctl", "bootout", "system/"+label(cfg.Name))
	_ = runSilently("launchctl", "enable", "system/"+label(cfg.Name))
	if err := run("launchctl", "bootstrap", "system", path); err != nil {
		return err
	}
	return run("launchctl", "kickstart", "-k", "system/"+label(cfg.Name))
}

// Uninstall boots out the daemon and removes its plist. The data directory is
// kept.
func Uninstall(name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	if os.Geteuid() != 0 {
		return errors.New("removing a system service requires root; re-run with sudo")
	}
	if err := requireLaunchctl(); err != nil {
		return err
	}
	_ = runSilently("launchctl", "bootout", "system/"+label(name))
	_ = runSilently("launchctl", "disable", "system/"+label(name))
	if err := os.Remove(plistPath(name)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove launchd plist: %w", err)
	}
	return nil
}

func Start(name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	if err := requireLaunchctl(); err != nil {
		return err
	}
	path := plistPath(name)
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("service %q is not installed: %w", name, err)
	}
	// bootstrap fails when the job is already loaded; kickstart below still
	// gives a useful error in that case.
	_ = runSilently("launchctl", "enable", "system/"+label(name))
	_ = runSilently("launchctl", "bootstrap", "system", path)
	return run("launchctl", "kickstart", "-k", "system/"+label(name))
}

func Stop(name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	if err := requireLaunchctl(); err != nil {
		return err
	}
	return run("launchctl", "bootout", "system/"+label(name))
}

func Restart(name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	_ = Stop(name)
	return Start(name)
}

func Status(name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	if err := requireLaunchctl(); err != nil {
		return err
	}
	return run("launchctl", "print", "system/"+label(name))
}

func Logs(name string, lines int) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	if lines <= 0 || lines > 10000 {
		lines = 100
	}
	for _, path := range []string{"/var/log/" + name + ".log", "/var/log/" + name + ".err.log"} {
		if _, err := os.Stat(path); err != nil {
			fmt.Printf("no log file at %s\n", path)
			continue
		}
		fmt.Printf("==> %s <==\n", path)
		if err := run("tail", "-n", strconv.Itoa(lines), path); err != nil {
			return err
		}
	}
	return nil
}

func renderLaunchdPlist(cfg Config) string {
	cfg = withDefaults(cfg)
	name := xmlText(cfg.Name)
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">` + "\n")
	b.WriteString("<plist version=\"1.0\">\n<dict>\n")
	fmt.Fprintf(&b, "  <key>Label</key><string>%s</string>\n", xmlText(label(cfg.Name)))
	b.WriteString("  <key>ProgramArguments</key>\n  <array>\n")
	for _, arg := range []string{cfg.ExecPath, "-addr", cfg.Addr, "-data", cfg.DataDir} {
		fmt.Fprintf(&b, "    <string>%s</string>\n", xmlText(arg))
	}
	b.WriteString("  </array>\n")
	if cfg.User != "" {
		fmt.Fprintf(&b, "  <key>UserName</key><string>%s</string>\n", xmlText(cfg.User))
	}
	b.WriteString("  <key>RunAtLoad</key><true/>\n")
	b.WriteString("  <key>KeepAlive</key><true/>\n")
	b.WriteString("  <key>ProcessType</key><string>Background</string>\n")
	b.WriteString("  <key>ThrottleInterval</key><integer>5</integer>\n")
	b.WriteString("  <key>EnvironmentVariables</key>\n  <dict>\n")
	b.WriteString("    <key>MONGOUI_RESTART_AFTER_UPDATE</key><string>1</string>\n")
	if cfg.Home != "" {
		fmt.Fprintf(&b, "    <key>HOME</key><string>%s</string>\n", xmlText(cfg.Home))
	}
	b.WriteString("    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>\n")
	if cfg.Repo != "" {
		fmt.Fprintf(&b, "    <key>MONGOUI_REPO</key><string>%s</string>\n", xmlText(cfg.Repo))
	}
	b.WriteString("  </dict>\n")
	fmt.Fprintf(&b, "  <key>StandardOutPath</key><string>%s</string>\n", xmlText("/var/log/"+name+".log"))
	fmt.Fprintf(&b, "  <key>StandardErrorPath</key><string>%s</string>\n", xmlText("/var/log/"+name+".err.log"))
	b.WriteString("</dict>\n</plist>\n")
	return b.String()
}

func xmlText(value string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(value))
	return b.String()
}

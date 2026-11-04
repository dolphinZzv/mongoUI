// Package service installs and manages mongoui under the host's service
// manager so it can start at boot and restart itself when the built-in updater
// replaces the binary.
package service

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Config describes the service to install. The command layer fills in the
// platform-specific defaults (for example the data directory).
type Config struct {
	Name     string
	ExecPath string
	Addr     string
	DataDir  string
	User     string
	Home     string
	Repo     string
	NoStart  bool
}

var serviceName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*$`)

// ValidateName rejects names that would escape the unit/plist directory or be
// interpreted as an option by systemctl/launchctl.
func ValidateName(name string) error {
	if !serviceName.MatchString(name) {
		return fmt.Errorf("invalid service name %q: use letters, digits, '.', '_' or '-'", name)
	}
	return nil
}

func withDefaults(cfg Config) Config {
	if cfg.Name == "" {
		cfg.Name = "mongoui"
	}
	if cfg.Addr == "" {
		cfg.Addr = ":8080"
	}
	if cfg.DataDir == "" {
		cfg.DataDir = DefaultDataDir()
	}
	if cfg.ExecPath == "" {
		if exe, err := os.Executable(); err == nil {
			cfg.ExecPath = exe
		}
	}
	if cfg.Home == "" {
		if cfg.User != "" {
			if u, err := user.Lookup(cfg.User); err == nil {
				cfg.Home = u.HomeDir
			}
		}
		if cfg.Home == "" {
			cfg.Home, _ = os.UserHomeDir()
		}
	}
	return cfg
}

func run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}
	return nil
}

func runIgnore(name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	_ = cmd.Run()
}

// runSilently is run for expected-failure probes such as booting out a launchd
// job that may not be loaded yet.
func runSilently(name string, args ...string) error {
	return exec.Command(name, args...).Run()
}

func ensureDataDir(dir, username string) error {
	if dir == "" {
		return errors.New("service data directory is required")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create data directory %s: %w", dir, err)
	}
	if username == "" {
		return nil
	}
	u, err := user.Lookup(username)
	if err != nil {
		return fmt.Errorf("look up service user %q: %w", username, err)
	}
	uid, err := strconv.Atoi(u.Uid)
	if err != nil {
		return fmt.Errorf("invalid uid for %q: %w", username, err)
	}
	gid, err := strconv.Atoi(u.Gid)
	if err != nil {
		return fmt.Errorf("invalid gid for %q: %w", username, err)
	}
	if err := os.Chown(dir, uid, gid); err != nil {
		return fmt.Errorf("chown data directory %s: %w", dir, err)
	}
	return nil
}

func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

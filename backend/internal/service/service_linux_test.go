//go:build linux

package service

import (
	"strings"
	"testing"
)

func TestRenderSystemdUnit(t *testing.T) {
	unit := renderSystemdUnit(Config{
		Name:     "mongoui-test",
		ExecPath: "/opt/Mongo UI/mongoui",
		Addr:     "127.0.0.1:18080",
		DataDir:  "/var/lib/mongoui test",
		User:     "mongoui",
		Repo:     "example/mongoui",
	})

	for _, want := range []string{
		"ExecStart=\"/opt/Mongo UI/mongoui\" -addr 127.0.0.1:18080 -data \"/var/lib/mongoui test\"",
		"User=mongoui",
		"Environment=MONGOUI_RESTART_AFTER_UPDATE=1",
		"Environment=MONGOUI_REPO=example/mongoui",
		"Restart=always",
		"RestartSec=5",
		"WantedBy=multi-user.target",
	} {
		if !strings.Contains(unit, want) {
			t.Fatalf("unit is missing %q:\n%s", want, unit)
		}
	}
}

func TestValidateName(t *testing.T) {
	for _, name := range []string{"mongoui", "mongoui-test", "mongo_ui.1"} {
		if err := ValidateName(name); err != nil {
			t.Fatalf("ValidateName(%q) = %v", name, err)
		}
	}
	for _, name := range []string{"", "../mongoui", "mongoui/test", "-mongoui", "mongo ui"} {
		if err := ValidateName(name); err == nil {
			t.Fatalf("ValidateName(%q) should fail", name)
		}
	}
}

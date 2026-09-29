package config

import (
	"bytes"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testCipher(t *testing.T) *Cipher {
	t.Helper()
	c, err := NewCipher(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	return c
}

func TestCipherRoundTrip(t *testing.T) {
	c := testCipher(t)
	enc, err := c.Encrypt("mongodb://user:pass@host:27017")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(enc, encryptedPrefix) {
		t.Fatalf("missing prefix: %s", enc)
	}
	dec, err := c.Decrypt(enc)
	if err != nil {
		t.Fatal(err)
	}
	if dec != "mongodb://user:pass@host:27017" {
		t.Fatalf("round trip = %q", dec)
	}
	// Values without the prefix pass through untouched.
	if got, _ := c.Decrypt("plain"); got != "plain" {
		t.Fatalf("plain passthrough = %q", got)
	}
	// Empty stays empty.
	if got, _ := c.Encrypt(""); got != "" {
		t.Fatalf("empty encrypt = %q", got)
	}
}

func TestStoreEncryptsAtRest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "connections.json")
	cipher := testCipher(t)

	store, err := NewStoreWithSecret(path, cipher)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := store.Add(Connection{
		Name: "prod",
		URI:  "mongodb://user:supersecret@host:27017",
		SSH: &SSHConfig{
			Enabled:    true,
			Host:       "bastion",
			User:       "ubuntu",
			Password:   "sshpassword",
			PrivateKey: "PRIVATEKEYMATERIAL",
			Passphrase: "keypass-9x7",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"supersecret", "sshpassword", "PRIVATEKEYMATERIAL", "keypass-9x7"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("secret %q leaked into %s", secret, raw)
		}
	}
	if !strings.Contains(string(raw), encryptedPrefix) {
		t.Fatalf("store is not encrypted: %s", raw)
	}

	// Reload with the same key restores the plaintext values.
	reloaded, err := NewStoreWithSecret(path, cipher)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := reloaded.Get(conn.ID)
	if !ok {
		t.Fatal("connection missing after reload")
	}
	if got.URI != "mongodb://user:supersecret@host:27017" {
		t.Fatalf("uri = %q", got.URI)
	}
	if got.SSH == nil || got.SSH.Password != "sshpassword" || got.SSH.PrivateKey != "PRIVATEKEYMATERIAL" {
		t.Fatalf("ssh = %+v", got.SSH)
	}
}

func TestStoreMigratesPlaintext(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "connections.json")

	plain, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := plain.Add(Connection{Name: "legacy", URI: "mongodb://plain:pass@host"})
	if err != nil {
		t.Fatal(err)
	}

	cipher := testCipher(t)
	migrated, err := NewStoreWithSecret(path, cipher)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	if strings.Contains(string(raw), "plain:pass") {
		t.Fatalf("plaintext not migrated: %s", raw)
	}
	got, _ := migrated.Get(conn.ID)
	if got.URI != "mongodb://plain:pass@host" {
		t.Fatalf("uri after migration = %q", got.URI)
	}
}

func TestWrongKeyFails(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "connections.json")
	cipher := testCipher(t)
	store, err := NewStoreWithSecret(path, cipher)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Add(Connection{Name: "x", URI: "mongodb://secret@host"}); err != nil {
		t.Fatal(err)
	}

	other, _ := NewCipher(bytes.Repeat([]byte{9}, 32))
	if _, err := NewStoreWithSecret(path, other); err == nil {
		t.Fatal("expected decryption error with the wrong key")
	}
}

func TestLoadKeyGeneratesAndReuses(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(KeyEnv, "")

	key, err := LoadKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(key) != 32 {
		t.Fatalf("key length = %d", len(key))
	}
	info, err := os.Stat(filepath.Join(dir, "secret.key"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("key file perm = %v", info.Mode().Perm())
	}
	again, err := LoadKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(key, again) {
		t.Fatal("key changed between loads")
	}

	envKey := bytes.Repeat([]byte{3}, 32)
	t.Setenv(KeyEnv, hex.EncodeToString(envKey))
	fromEnv, err := LoadKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(fromEnv, envKey) {
		t.Fatal("env key not used")
	}
}

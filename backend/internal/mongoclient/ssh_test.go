package mongoclient

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"mongoui/internal/config"
)

func generateEd25519(t *testing.T) (ssh.Signer, string) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	block, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	return signer, string(pem.EncodeToMemory(block))
}

// startEcho starts a TCP server that echoes everything back.
func startEcho(t *testing.T) (string, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("echo listen: %v", err)
	}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_, _ = io.Copy(c, c)
			}(c)
		}
	}()
	return ln.Addr().String(), func() { _ = ln.Close() }
}

// startSSHServer starts a minimal SSH server that supports direct-tcpip
// forwarding, which is exactly what sshDialer relies on. It also returns a
// known_hosts file containing the server key so tests exercise strict host key
// verification.
func startSSHServer(t *testing.T, hostKey ssh.Signer, acceptKey ssh.PublicKey) (string, int, string, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("ssh listen: %v", err)
	}

	cfg := &ssh.ServerConfig{
		PublicKeyCallback: func(_ ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if acceptKey != nil && bytes.Equal(key.Marshal(), acceptKey.Marshal()) {
				return nil, nil
			}
			return nil, fmt.Errorf("unauthorized key")
		},
		PasswordCallback: func(_ ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			if string(password) == "secret" {
				return nil, nil
			}
			return nil, fmt.Errorf("unauthorized password")
		},
	}
	cfg.AddHostKey(hostKey)

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go serveSSHConn(conn, cfg)
		}
	}()

	addr := ln.Addr().(*net.TCPAddr)
	host := "127.0.0.1"
	knownHosts := filepath.Join(t.TempDir(), "known_hosts")
	line := knownhosts.Line(
		[]string{knownhosts.Normalize(net.JoinHostPort(host, strconv.Itoa(addr.Port)))},
		hostKey.PublicKey(),
	)
	if err := os.WriteFile(knownHosts, []byte(line+"\n"), 0o600); err != nil {
		t.Fatalf("write known_hosts: %v", err)
	}
	return host, addr.Port, knownHosts, func() { _ = ln.Close() }
}

func serveSSHConn(conn net.Conn, cfg *ssh.ServerConfig) {
	sconn, chans, reqs, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		_ = conn.Close()
		return
	}
	defer sconn.Close()
	go ssh.DiscardRequests(reqs)

	for newCh := range chans {
		if newCh.ChannelType() != "direct-tcpip" {
			_ = newCh.Reject(ssh.UnknownChannelType, "only direct-tcpip is supported")
			continue
		}
		var req struct {
			Host       string
			Port       uint32
			OriginHost string
			OriginPort uint32
		}
		if err := ssh.Unmarshal(newCh.ExtraData(), &req); err != nil {
			_ = newCh.Reject(ssh.ConnectionFailed, "bad direct-tcpip payload")
			continue
		}
		target, err := net.Dial("tcp", net.JoinHostPort(req.Host, strconv.Itoa(int(req.Port))))
		if err != nil {
			_ = newCh.Reject(ssh.ConnectionFailed, "dial target failed")
			continue
		}
		ch, chReqs, err := newCh.Accept()
		if err != nil {
			_ = target.Close()
			continue
		}
		go ssh.DiscardRequests(chReqs)
		go func() { _, _ = io.Copy(ch, target); _ = ch.Close() }()
		go func() { _, _ = io.Copy(target, ch); _ = target.Close() }()
	}
}

func TestSSHTunnelForwardsToTarget(t *testing.T) {
	echoAddr, stopEcho := startEcho(t)
	defer stopEcho()

	hostKey, _ := generateEd25519(t)
	clientSigner, clientKeyPEM := generateEd25519(t)
	host, port, knownHosts, stopSSH := startSSHServer(t, hostKey, clientSigner.PublicKey())
	defer stopSSH()

	cfg := config.SSHConfig{
		Enabled:    true,
		Host:       host,
		Port:       port,
		User:       "tester",
		AuthMethod: "privateKey",
		PrivateKey: clientKeyPEM,
		KnownHosts: knownHosts,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := newSSHTunnel(ctx, cfg)
	if err != nil {
		t.Fatalf("newSSHTunnel: %v", err)
	}
	defer client.Close()

	conn, err := client.DialContext(ctx, "tcp", echoAddr)
	if err != nil {
		t.Fatalf("DialContext: %v", err)
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := conn.Write([]byte("hello")); err != nil {
		t.Fatalf("write: %v", err)
	}
	buf := make([]byte, len("hello"))
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(buf) != "hello" {
		t.Fatalf("echo = %q, want %q", buf, "hello")
	}
}

func TestSSHTunnelPasswordInferred(t *testing.T) {
	hostKey, _ := generateEd25519(t)
	host, port, knownHosts, stopSSH := startSSHServer(t, hostKey, nil)
	defer stopSSH()

	// No AuthMethod set: it must be inferred as password.
	cfg := config.SSHConfig{Enabled: true, Host: host, Port: port, User: "tester", Password: "secret", KnownHosts: knownHosts}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := dialSSH(ctx, cfg)
	if err != nil {
		t.Fatalf("dialSSH: %v", err)
	}
	_ = client.Close()
}

func TestSSHAuthMethodsValidation(t *testing.T) {
	if _, err := sshAuthMethods(config.SSHConfig{AuthMethod: "password"}); err == nil {
		t.Fatal("expected error for missing password")
	}
	if _, err := sshAuthMethods(config.SSHConfig{AuthMethod: "privateKey"}); err == nil {
		t.Fatal("expected error for missing private key")
	}
	if _, err := sshAuthMethods(config.SSHConfig{AuthMethod: "nope"}); err == nil {
		t.Fatal("expected error for unknown auth method")
	}
}

func TestDialSSHRequiresHostAndUser(t *testing.T) {
	ctx := context.Background()
	if _, err := dialSSH(ctx, config.SSHConfig{User: "u", Password: "p"}); err == nil {
		t.Fatal("expected error for missing host")
	}
	if _, err := dialSSH(ctx, config.SSHConfig{Host: "h", Password: "p"}); err == nil {
		t.Fatal("expected error for missing user")
	}
}

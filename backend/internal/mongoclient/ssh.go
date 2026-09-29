package mongoclient

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"mongoui/internal/config"
)

const sshDialTimeout = 10 * time.Second

// sshTunnel forwards MongoDB TCP connections through an SSH jump host.
//
// The mongo driver requires net.Conn implementations that support deadlines,
// which ssh.Client's channels do not ("tcpChan: deadline not supported"). So
// instead of handing the SSH channel to the driver, each target gets a local
// loopback listener: the driver dials localhost (a real net.Conn with working
// deadlines) and we copy bytes between it and the SSH-forwarded connection.
type sshTunnel struct {
	client *ssh.Client

	mu        sync.Mutex
	listeners map[string]net.Listener
	closed    bool
}

// newSSHTunnel opens the SSH jump host and returns a dialer for the driver.
func newSSHTunnel(ctx context.Context, cfg config.SSHConfig) (*sshTunnel, error) {
	client, err := dialSSH(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return &sshTunnel{client: client, listeners: make(map[string]net.Listener)}, nil
}

// DialContext implements the driver's ContextDialer interface. The address is
// the MongoDB host:port; it is reached from the SSH server.
func (t *sshTunnel) DialContext(ctx context.Context, _, address string) (net.Conn, error) {
	ln, err := t.listener(address)
	if err != nil {
		return nil, err
	}
	var d net.Dialer
	return d.DialContext(ctx, "tcp", ln.Addr().String())
}

func (t *sshTunnel) listener(address string) (net.Listener, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return nil, errors.New("ssh tunnel is closed")
	}
	if ln, ok := t.listeners[address]; ok {
		return ln, nil
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("ssh tunnel listener: %w", err)
	}
	t.listeners[address] = ln
	go t.accept(ln, address)
	return ln, nil
}

func (t *sshTunnel) accept(ln net.Listener, target string) {
	for {
		local, err := ln.Accept()
		if err != nil {
			return
		}
		go func() {
			remote, err := t.client.Dial("tcp", target)
			if err != nil {
				_ = local.Close()
				return
			}
			proxyConns(local, remote)
		}()
	}
}

// Close stops forwarding and closes the SSH connection.
func (t *sshTunnel) Close() error {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil
	}
	t.closed = true
	listeners := t.listeners
	t.listeners = nil
	t.mu.Unlock()

	for _, ln := range listeners {
		_ = ln.Close()
	}
	return t.client.Close()
}

func proxyConns(a, b net.Conn) {
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(a, b); done <- struct{}{} }()
	go func() { _, _ = io.Copy(b, a); done <- struct{}{} }()
	<-done
	_ = a.Close()
	_ = b.Close()
}

// dialSSH opens the SSH connection used as a jump host.
func dialSSH(ctx context.Context, cfg config.SSHConfig) (*ssh.Client, error) {
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		return nil, errors.New("ssh host is required")
	}
	user := strings.TrimSpace(cfg.User)
	if user == "" {
		return nil, errors.New("ssh user is required")
	}
	port := cfg.Port
	if port <= 0 {
		port = 22
	}

	auths, err := sshAuthMethods(cfg)
	if err != nil {
		return nil, err
	}
	hostKey, err := sshHostKeyCallback(cfg)
	if err != nil {
		return nil, err
	}

	clientCfg := &ssh.ClientConfig{
		User:            user,
		Auth:            auths,
		HostKeyCallback: hostKey,
		Timeout:         sshDialTimeout,
	}

	addr := net.JoinHostPort(host, strconv.Itoa(port))
	dialer := &net.Dialer{Timeout: sshDialTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("ssh dial %s: %w", addr, err)
	}
	sshConn, chans, reqs, err := ssh.NewClientConn(conn, addr, clientCfg)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("ssh handshake with %s: %w", addr, err)
	}
	return ssh.NewClient(sshConn, chans, reqs), nil
}

// sshAuthMethods builds the SSH authentication methods from the profile. When
// AuthMethod is empty it is inferred from the credential that is present.
func sshAuthMethods(cfg config.SSHConfig) ([]ssh.AuthMethod, error) {
	method := cfg.AuthMethod
	if method == "" {
		if strings.TrimSpace(cfg.PrivateKey) != "" {
			method = "privateKey"
		} else {
			method = "password"
		}
	}

	switch method {
	case "password":
		if cfg.Password == "" {
			return nil, errors.New("ssh password is required")
		}
		return []ssh.AuthMethod{ssh.Password(cfg.Password)}, nil
	case "privateKey":
		if strings.TrimSpace(cfg.PrivateKey) == "" {
			return nil, errors.New("ssh private key is required")
		}
		var (
			signer ssh.Signer
			err    error
		)
		if cfg.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(cfg.PrivateKey), []byte(cfg.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(cfg.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("parse ssh private key: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	default:
		return nil, fmt.Errorf("unknown ssh auth method %q", method)
	}
}

// sshHostKeyCallback verifies the bastion's host key against a known_hosts file
// when one is configured; otherwise the key is accepted without verification.
func sshHostKeyCallback(cfg config.SSHConfig) (ssh.HostKeyCallback, error) {
	if path := strings.TrimSpace(cfg.KnownHosts); path != "" {
		cb, err := knownhosts.New(path)
		if err != nil {
			return nil, fmt.Errorf("load known_hosts %q: %w", path, err)
		}
		return cb, nil
	}
	return ssh.InsecureIgnoreHostKey(), nil
}

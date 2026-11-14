// Package mcp implements a Model Context Protocol server so external agents can
// operate mongoUI (and therefore MongoDB) over MCP instead of talking to the
// database directly. Operations go through the same connection store, SSH
// tunnels and read-only flag the UI uses.
//
// Two transports are supported:
//   - stdio:  `mongoui mcp` speaks newline-delimited JSON-RPC on stdin/stdout.
//   - HTTP:   POST /mcp implements the MCP "Streamable HTTP" transport.
package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"go.mongodb.org/mongo-driver/mongo"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

const protocolVersion = "2024-11-05"

// TokenAuthorizer validates a personal access token from the request's
// Authorization header and reports whether authentication is enabled at all.
// The interface keeps the MCP package independent of the auth package.
type TokenAuthorizer interface {
	TokenScopes(*http.Request) ([]string, bool)
	Enabled() bool
}

// ConnectionAuthorizer is an optional extension implemented by the auth
// manager. A nil list means the token may access every connection.
type ConnectionAuthorizer interface {
	TokenConnectionIDs(*http.Request) ([]string, bool)
}

// ActorAuthorizer is implemented by the auth manager so MCP audit entries can
// identify the account and PAT that performed a write.
type ActorAuthorizer interface {
	AuditActor(*http.Request) (username, tokenID string)
}

// AuditEvent is one MCP write-operation audit record.
type AuditEvent struct {
	Actor        string
	TokenID      string
	IP           string
	Tool         string
	ConnectionID string
	Database     string
	Collection   string
	Status       string
	Error        string
}

// AuditSink receives MCP write audit events from the API's audit log.
type AuditSink interface {
	RecordMCP(AuditEvent)
}

const (
	scopeRead  = "read"
	scopeWrite = "write"
)

var allScopes = []string{scopeRead, scopeWrite, "admin"}

// Server exposes mongoUI operations as MCP tools.
type Server struct {
	store      *config.Store
	mgr        *mongoclient.Manager
	version    string
	settings   *config.Settings
	authorizer TokenAuthorizer
	proposals  *proposalStore
	auditSink  AuditSink
}

// New creates an MCP server backed by the given connection store and manager.
// settings controls whether the server is enabled and which tool groups are
// exposed. It may be nil, in which case safe defaults are used.
func New(store *config.Store, mgr *mongoclient.Manager, version string, settings *config.Settings) *Server {
	if settings == nil {
		settings = config.NewSettings(config.DefaultMCPSettings())
	}
	server := &Server{store: store, mgr: mgr, version: version, settings: settings, proposals: newProposalStore()}
	if store != nil {
		if dir := store.Dir(); dir != "" {
			server.proposals.configureLocal(filepath.Join(dir, "proposals.bson"), store.Cipher())
		}
	}
	return server
}

// SetProposalCollection switches proposal persistence to the coordination
// collection. Call it before serving requests when MONGOUI_COORDINATION_URI is
// configured so approvals are shared across instances.
func (s *Server) SetProposalCollection(coll *mongo.Collection) {
	if coll != nil {
		s.proposals.setCollection(coll)
	}
}

// SetTokenAuthorizer enables personal access token authentication for the HTTP
// transport.
func (s *Server) SetTokenAuthorizer(authorizer TokenAuthorizer) {
	s.authorizer = authorizer
}

// SetAuditSink attaches the server-side audit log for MCP write operations.
func (s *Server) SetAuditSink(sink AuditSink) {
	s.auditSink = sink
}

// enabled reports whether the MCP server capability is switched on.
func (s *Server) enabled() bool {
	return s.settings.GetMCP().Enabled
}

// groupEnabled reports whether a tool group is exposed.
func (s *Server) groupEnabled(group toolGroup) bool {
	cfg := s.settings.GetMCP()
	switch group {
	case readGroup:
		return cfg.Read
	case writeGroup:
		return cfg.Write
	default:
		return false
	}
}

// --- JSON-RPC plumbing ------------------------------------------------------

type auditMeta struct {
	Actor   string
	TokenID string
	IP      string
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// handle processes one JSON-RPC message with full access. Used by the local
// stdio transport, which already runs as the server owner.
func (s *Server) handle(raw []byte) []byte {
	return s.handleWithScopes(raw, allScopes, nil, auditMeta{Actor: "stdio"})
}

// handleWithScopes processes one JSON-RPC message using the scopes and
// connection allowlist granted to the HTTP caller. Write tools are hidden and
// rejected for read-only PATs; tools targeting a disallowed connection fail.
func (s *Server) handleWithScopes(raw []byte, scopes, connections []string, audit auditMeta) []byte {
	var req rpcRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return encode(rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: -32700, Message: "parse error"}})
	}
	if len(req.ID) == 0 { // notification
		return nil
	}

	switch req.Method {
	case "initialize":
		return encode(rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"protocolVersion": protocolVersion,
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "mongoui", "version": s.version},
				"instructions": "MongoUI MCP server. Call mongoui_list_connections first to get a " +
					"connectionId, then mongoui_connect before reading or writing data. " +
					"Tools are grouped into read and write groups; read-only connections reject write tools.",
			},
		})
	case "ping":
		return encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: map[string]any{}})
	case "tools/list":
		return encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: map[string]any{"tools": s.toolDefsForScopes(scopes)}})
	case "resources/list":
		return encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: map[string]any{"resources": []any{}}})
	case "prompts/list":
		return encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: map[string]any{"prompts": []any{}}})
	case "tools/call":
		var params struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Error: &rpcError{Code: -32602, Message: "invalid params"}})
		}
		text, err := s.callToolWithScopes(params.Name, params.Arguments, scopes, connections, audit)
		if err != nil {
			return encode(rpcResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]any{
					"content": []map[string]any{{"type": "text", "text": err.Error()}},
					"isError": true,
				},
			})
		}
		return encode(rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result:  map[string]any{"content": []map[string]any{{"type": "text", "text": text}}},
		})
	default:
		return encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Error: &rpcError{Code: -32601, Message: "method not found: " + req.Method}})
	}
}

func encode(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte(`{"jsonrpc":"2.0","error":{"code":-32603,"message":"internal error"}}`)
	}
	return b
}

// --- stdio transport --------------------------------------------------------

// ServeStdio reads newline-delimited JSON-RPC from in and writes responses to
// out. Logs go to stderr so stdout stays a clean protocol channel.
func (s *Server) ServeStdio(_ context.Context, in io.Reader, out io.Writer) error {
	if !s.enabled() {
		return errors.New("MCP server is disabled; enable it in the UI settings (or edit settings.json)")
	}
	log.SetOutput(os.Stderr)
	log.SetPrefix("mongoui-mcp: ")
	log.Printf("MCP server started (stdio)")

	reader := bufio.NewReaderSize(in, 4<<20)
	writer := bufio.NewWriter(out)
	defer writer.Flush()

	for {
		line, err := reader.ReadString('\n')
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			if resp := s.handle([]byte(trimmed)); resp != nil {
				if _, err := writer.Write(resp); err != nil {
					return err
				}
				if err := writer.WriteByte('\n'); err != nil {
					return err
				}
				if err := writer.Flush(); err != nil {
					return err
				}
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

// --- HTTP (Streamable HTTP) transport ---------------------------------------

// HTTPHandler exposes the MCP server over HTTP so remote agents can connect to
// a running mongoui server.
//
//	POST   /mcp : JSON-RPC request; JSON, or an SSE stream with Accept: text/event-stream
//	DELETE /mcp : ends the session
//	GET    /mcp : not supported (405)
func (s *Server) HTTPHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.enabled() {
			http.Error(w, "MCP server is disabled", http.StatusNotFound)
			return
		}
		actor, tokenID := "", ""
		if aa, ok := s.authorizer.(ActorAuthorizer); ok {
			actor, tokenID = aa.AuditActor(r)
		}
		audit := auditMeta{Actor: actor, TokenID: tokenID, IP: remoteIP(r)}
		scopes, connections, ok := s.authorized(r)
		if !ok {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		switch r.Method {
		case http.MethodOptions:
			w.WriteHeader(http.StatusNoContent)
		case http.MethodPost:
			body, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
			if err != nil {
				http.Error(w, "failed to read body", http.StatusBadRequest)
				return
			}
			session := r.Header.Get("Mcp-Session-Id")
			if session == "" {
				session = randomToken()
			}
			w.Header().Set("Mcp-Session-Id", session)

			resp := s.handleWithScopes(body, scopes, connections, audit)

			if strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
				w.Header().Set("Content-Type", "text/event-stream")
				w.Header().Set("Cache-Control", "no-cache")
				w.Header().Set("Connection", "keep-alive")
				w.WriteHeader(http.StatusOK)
				if resp != nil {
					_, _ = fmt.Fprintf(w, "event: message\ndata: %s\n\n", resp)
				}
				if f, ok := w.(http.Flusher); ok {
					f.Flush()
				}
				return
			}

			if resp == nil {
				w.WriteHeader(http.StatusAccepted)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(resp)
		case http.MethodDelete:
			w.WriteHeader(http.StatusOK)
		default:
			w.Header().Set("Allow", "POST, DELETE, OPTIONS")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
}

func remoteIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func (s *Server) authorized(r *http.Request) ([]string, []string, bool) {
	if s.authorizer != nil {
		if scopes, ok := s.authorizer.TokenScopes(r); ok {
			var connections []string
			if scoped, ok := s.authorizer.(ConnectionAuthorizer); ok {
				list, ok := scoped.TokenConnectionIDs(r)
				if !ok {
					return nil, nil, false
				}
				connections = list
			}
			return scopes, connections, true
		}
		if s.authorizer.Enabled() {
			return nil, nil, false
		}
	}
	// No account system configured: preserve the original local-hosting
	// behaviour where the MCP endpoint is open.
	return allScopes, nil, true
}

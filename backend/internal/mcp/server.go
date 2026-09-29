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
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"mongoui/internal/config"
	"mongoui/internal/mongoclient"
)

const protocolVersion = "2024-11-05"

// Server exposes mongoUI operations as MCP tools.
type Server struct {
	store    *config.Store
	mgr      *mongoclient.Manager
	version  string
	token    string
	readOnly bool
}

// New creates an MCP server backed by the given connection store and manager.
// When token is non-empty, the HTTP transport requires a matching bearer token.
// When readOnly is true, write tools are hidden from tools/list and rejected.
func New(store *config.Store, mgr *mongoclient.Manager, version, token string, readOnly bool) *Server {
	return &Server{store: store, mgr: mgr, version: version, token: token, readOnly: readOnly}
}

// --- JSON-RPC plumbing ------------------------------------------------------

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

// handle processes one JSON-RPC message and returns the encoded response, or nil
// for notifications (which expect no reply).
func (s *Server) handle(raw []byte) []byte {
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
					"Read-only connections reject write tools.",
			},
		})
	case "ping":
		return encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: map[string]any{}})
	case "tools/list":
		return encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: map[string]any{"tools": s.toolDefs()}})
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
		text, err := s.callTool(params.Name, params.Arguments)
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
		if !s.authorized(r) {
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

			resp := s.handle(body)

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

func (s *Server) authorized(r *http.Request) bool {
	if s.token == "" {
		return true
	}
	header := r.Header.Get("Authorization")
	expected := "Bearer " + s.token
	return subtle.ConstantTimeCompare([]byte(header), []byte(expected)) == 1
}

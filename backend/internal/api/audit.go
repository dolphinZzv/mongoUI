package api

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"mongoui/internal/mcp"
)

const (
	// auditCapacity bounds the in-memory audit ring buffer so it can never grow
	// without limit (writes are frequent, entries are small).
	auditCapacity = 1000
	// auditMaxBytes caps the on-disk log; once exceeded it is rewritten from the
	// bounded in-memory buffer, so the file stays small too.
	auditMaxBytes = 1 << 20
	auditFileName = "audit.jsonl"
)

type auditEntry struct {
	Time         string    `json:"time" bson:"time"`
	Actor        string    `json:"actor,omitempty" bson:"actor,omitempty"`
	TokenID      string    `json:"tokenId,omitempty" bson:"tokenId,omitempty"`
	IP           string    `json:"ip,omitempty" bson:"ip,omitempty"`
	ConnectionID string    `json:"connectionId,omitempty" bson:"connectionId,omitempty"`
	Database     string    `json:"database,omitempty" bson:"database,omitempty"`
	Collection   string    `json:"collection,omitempty" bson:"collection,omitempty"`
	Method       string    `json:"method" bson:"method"`
	Operation    string    `json:"operation" bson:"operation"`
	Path         string    `json:"path" bson:"path"`
	Status       int       `json:"status" bson:"status"`
	Error        string    `json:"error,omitempty" bson:"error,omitempty"`
	ExpireAt     time.Time `json:"-" bson:"expireAt,omitempty"`
}

type auditLog struct {
	mu      sync.Mutex
	entries []auditEntry
	// path is empty when persistence is disabled (e.g. in tests).
	path string
	// coll is the optional coordination collection used by multi-instance
	// deployments.
	coll          *mongo.Collection
	webhookURL    string
	webhookSecret string
	webhookClient *http.Client
}

// newAuditLog creates a log persisted to <dataDir>/audit.jsonl. An empty
// dataDir keeps it in memory only.
func newAuditLog(dataDir string) *auditLog {
	log := &auditLog{
		entries:       make([]auditEntry, 0, auditCapacity),
		webhookClient: &http.Client{Timeout: 5 * time.Second},
	}
	if dataDir != "" {
		log.path = filepath.Join(dataDir, auditFileName)
		log.load()
	}
	return log
}

// SetCollection switches audit persistence/listing to a coordination
// collection. The local ring remains as a fallback if the coordination store is
// temporarily unavailable.
func (l *auditLog) SetCollection(coll *mongo.Collection) {
	if l == nil || coll == nil {
		return
	}
	l.mu.Lock()
	l.coll = coll
	l.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, _ = coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "time", Value: -1}},
		Options: options.Index().SetName("audit_time"),
	})
	_, _ = coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "expireAt", Value: 1}},
		Options: options.Index().SetName("audit_ttl").SetExpireAfterSeconds(0),
	})
}

// SetWebhook forwards every new audit entry to an external SIEM/webhook. The
// secret is used as an HMAC-SHA256 key in X-Mongoui-Signature.
func (l *auditLog) SetWebhook(rawURL, secret string) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.webhookURL = strings.TrimSpace(rawURL)
	l.webhookSecret = secret
}

// load reads the tail of the persisted log so entries survive a restart.
func (l *auditLog) load() {
	data, err := os.ReadFile(l.path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		if line == "" {
			continue
		}
		var entry auditEntry
		if json.Unmarshal([]byte(line), &entry) == nil {
			l.entries = append(l.entries, entry)
		}
	}
	if len(l.entries) > auditCapacity {
		l.entries = l.entries[len(l.entries)-auditCapacity:]
	}
}

func (l *auditLog) add(entry auditEntry) {
	if entry.Time == "" {
		entry.Time = time.Now().UTC().Format(time.RFC3339)
	}
	entry.ExpireAt = time.Now().UTC().Add(90 * 24 * time.Hour)
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = append(l.entries, entry)
	if len(l.entries) > auditCapacity {
		l.entries = l.entries[len(l.entries)-auditCapacity:]
	}
	if l.coll != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, err := l.coll.InsertOne(ctx, entry)
		cancel()
		if err == nil {
			l.forward(entry)
			return
		}
	}
	l.persist(entry)
	l.forward(entry)
}

func (l *auditLog) forward(entry auditEntry) {
	url, secret, client := l.webhookURL, l.webhookSecret, l.webhookClient
	if url == "" || client == nil {
		return
	}
	go func() {
		body, err := json.Marshal(entry)
		if err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			log.Printf("audit webhook: %v", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		if secret != "" {
			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write(body)
			req.Header.Set("X-Mongoui-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
		}
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("audit webhook: %v", err)
			return
		}
		_ = resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			log.Printf("audit webhook: HTTP %d", resp.StatusCode)
		}
	}()
}

// persist appends the entry as one JSON line, rotating the file first when it
// has grown past auditMaxBytes.
func (l *auditLog) persist(entry auditEntry) {
	if l.path == "" {
		return
	}
	if info, err := os.Stat(l.path); err == nil && info.Size() > auditMaxBytes {
		l.rotate()
	}
	line, err := json.Marshal(entry)
	if err != nil {
		return
	}
	file, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.Write(append(line, '\n'))
}

// rotate rewrites the file from the bounded in-memory buffer.
func (l *auditLog) rotate() {
	tmp := l.path + ".tmp"
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	encoder := json.NewEncoder(file)
	for _, entry := range l.entries {
		_ = encoder.Encode(entry)
	}
	_ = file.Close()
	_ = os.Rename(tmp, l.path)
}

// list returns entries newest-first, optionally filtered by connection.
func (l *auditLog) list(connectionID string, limit int) []auditEntry {
	if limit <= 0 || limit > auditCapacity {
		limit = 200
	}
	l.mu.Lock()
	coll := l.coll
	l.mu.Unlock()
	if coll != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		filter := bson.M{}
		if connectionID != "" {
			filter["connectionId"] = connectionID
		}
		cursor, err := coll.Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "time", Value: -1}}).SetLimit(int64(limit)))
		if err == nil {
			defer cursor.Close(ctx)
			var out []auditEntry
			if err := cursor.All(ctx, &out); err == nil {
				return out
			}
		}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]auditEntry, 0, limit)
	for i := len(l.entries) - 1; i >= 0 && len(out) < limit; i-- {
		if connectionID != "" && l.entries[i].ConnectionID != connectionID {
			continue
		}
		out = append(out, l.entries[i])
	}
	return out
}

func isWriteMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func operationFromPath(path string) string {
	segments := strings.Split(strings.Trim(path, "/"), "/")
	if len(segments) == 0 {
		return ""
	}
	return segments[len(segments)-1]
}

// auditMiddleware records every write request, including failed ones, so the
// log can answer both "who changed this?" and "who tried?". It is also mounted
// around the auth routes to capture login/configuration attempts.
func (a *API) auditMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if a.audit == nil || !isWriteMethod(r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		actor, tokenID := "", ""
		if a.auth != nil {
			actor, tokenID = a.auth.AuditActor(r)
		}
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		status := ww.Status()
		if status == 0 {
			status = http.StatusOK
		}
		a.audit.add(auditEntry{
			Actor:        actor,
			TokenID:      tokenID,
			IP:           remoteIP(r),
			ConnectionID: chi.URLParam(r, "id"),
			Database:     chi.URLParam(r, "db"),
			Collection:   chi.URLParam(r, "col"),
			Method:       r.Method,
			Operation:    operationFromPath(path),
			Path:         path,
			Status:       status,
		})
	})
}

func remoteIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func (a *API) listAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	ok(w, map[string]any{
		"entries": a.audit.list(r.URL.Query().Get("connectionId"), limit),
	})
}

func (a *API) exportAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > auditCapacity {
		limit = auditCapacity
	}
	entries := a.audit.list(r.URL.Query().Get("connectionId"), limit)
	format := strings.ToLower(r.URL.Query().Get("format"))
	if format == "" {
		format = "jsonl"
	}
	name := "mongoui-audit-" + time.Now().UTC().Format("20060102-150405")
	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=\""+name+".csv\"")
		w.Header().Set("Cache-Control", "no-store")
		cw := csv.NewWriter(w)
		_ = cw.Write([]string{"time", "actor", "tokenId", "ip", "connectionId", "database", "collection", "method", "operation", "path", "status", "error"})
		for _, e := range entries {
			_ = cw.Write([]string{e.Time, e.Actor, e.TokenID, e.IP, e.ConnectionID, e.Database, e.Collection, e.Method, e.Operation, e.Path, strconv.Itoa(e.Status), e.Error})
		}
		cw.Flush()
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+name+".jsonl\"")
	w.Header().Set("Cache-Control", "no-store")
	enc := json.NewEncoder(w)
	for _, e := range entries {
		_ = enc.Encode(e)
	}
}

func (a *API) SetAuditCollection(coll *mongo.Collection) {
	if a.audit != nil {
		a.audit.SetCollection(coll)
	}
}

func (a *API) SetAuditWebhook(url, secret string) {
	if a.audit != nil {
		a.audit.SetWebhook(url, secret)
	}
}

// RecordMCP appends an MCP write operation to the same audit ring used by the
// HTTP API. MCP calls bypass the /api middleware, so the server calls this hook.
func (a *API) RecordMCP(e mcp.AuditEvent) {
	if a.audit == nil {
		return
	}
	status := http.StatusOK
	if e.Status == "error" {
		status = http.StatusInternalServerError
	}
	a.audit.add(auditEntry{
		Actor:        e.Actor,
		TokenID:      e.TokenID,
		IP:           e.IP,
		ConnectionID: e.ConnectionID,
		Database:     e.Database,
		Collection:   e.Collection,
		Method:       "MCP",
		Operation:    e.Tool,
		Path:         "/mcp",
		Status:       status,
		Error:        e.Error,
	})
}

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
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
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
	ID           string    `json:"id,omitempty" bson:"id,omitempty"`
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
	fileMu  sync.Mutex
	entries []auditEntry
	// path is empty when persistence is disabled (e.g. in tests).
	path string
	// coll is the optional coordination collection used by multi-instance
	// deployments.
	coll          *mongo.Collection
	webhookURL    string
	webhookSecret string
	webhookClient *http.Client
	// webhookSem bounds the number of in-flight webhook deliveries so a slow
	// SIEM endpoint cannot create an unbounded goroutine pile-up.
	webhookSem chan struct{}
}

// newAuditLog creates a log persisted to <dataDir>/audit.jsonl. An empty
// dataDir keeps it in memory only.
func newAuditLog(dataDir string) *auditLog {
	log := &auditLog{
		entries:       make([]auditEntry, 0, auditCapacity),
		webhookClient: &http.Client{Timeout: 5 * time.Second},
		webhookSem:    make(chan struct{}, 16),
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
			if entry.ID == "" {
				entry.ID = uuid.NewString()
			}
			l.entries = append(l.entries, entry)
		}
	}
	if len(l.entries) > auditCapacity {
		l.entries = l.entries[len(l.entries)-auditCapacity:]
	}
}

func (l *auditLog) add(entry auditEntry) {
	if entry.ID == "" {
		entry.ID = uuid.NewString()
	}
	if entry.Time == "" {
		entry.Time = time.Now().UTC().Format(time.RFC3339)
	}
	entry.ExpireAt = time.Now().UTC().Add(90 * 24 * time.Hour)

	// Never hold the mutex while talking to Mongo or the filesystem: those
	// operations can take seconds and would serialize every audited request.
	l.mu.Lock()
	l.entries = append(l.entries, entry)
	if len(l.entries) > auditCapacity {
		l.entries = l.entries[len(l.entries)-auditCapacity:]
	}
	coll := l.coll
	l.mu.Unlock()

	if coll != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, err := coll.InsertOne(ctx, entry)
		cancel()
		if err == nil {
			l.forward(entry)
			return
		}
		// Fall through to the local file. list() merges local entries back into
		// coordinated results, so a coordination outage does not silently erase
		// the audit trail.
	}
	l.persist(entry)
	l.forward(entry)
}

func (l *auditLog) forward(entry auditEntry) {
	l.mu.Lock()
	url, secret, client, sem := l.webhookURL, l.webhookSecret, l.webhookClient, l.webhookSem
	l.mu.Unlock()
	if url == "" || client == nil || sem == nil {
		return
	}
	select {
	case sem <- struct{}{}:
	default:
		log.Printf("audit webhook: delivery queue is full; dropping event")
		return
	}
	go func() {
		defer func() { <-sem }()
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
	l.fileMu.Lock()
	defer l.fileMu.Unlock()
	if l.path == "" {
		return
	}
	if info, err := os.Stat(l.path); err == nil && info.Size() > auditMaxBytes {
		l.rotateLocked()
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

// rotateLocked rewrites the file from the bounded in-memory buffer. The caller
// must hold fileMu.
func (l *auditLog) rotateLocked() {
	tmp := l.path + ".tmp"
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	l.mu.Lock()
	entries := append([]auditEntry(nil), l.entries...)
	l.mu.Unlock()
	encoder := json.NewEncoder(file)
	for _, entry := range entries {
		_ = encoder.Encode(entry)
	}
	_ = file.Close()
	_ = os.Rename(tmp, l.path)
}

// list returns entries newest-first, optionally filtered by connection.
func (l *auditLog) list(connectionID string, limit int) []auditEntry {
	return l.listFiltered(connectionID, limit, nil)
}

// listFiltered is list with an additional visibility predicate. It merges the
// local ring with the coordination collection so entries written during a
// coordination outage are still visible.
func (l *auditLog) listFiltered(connectionID string, limit int, allow func(auditEntry) bool) []auditEntry {
	if limit <= 0 || limit > auditCapacity {
		limit = 200
	}
	l.mu.Lock()
	coll := l.coll
	local := append([]auditEntry(nil), l.entries...)
	l.mu.Unlock()

	// Fetch more than the requested page when filtering because disallowed
	// entries are removed after the query.
	queryLimit := limit
	if allow != nil {
		queryLimit = auditCapacity
	}
	var combined []auditEntry
	if coll != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		filter := bson.M{}
		if connectionID != "" {
			filter["connectionId"] = connectionID
		}
		cursor, err := coll.Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "time", Value: -1}}).SetLimit(int64(queryLimit)))
		if err == nil {
			if err := cursor.All(ctx, &combined); err != nil {
				combined = nil
			}
			_ = cursor.Close(ctx)
		}
		cancel()
	}

	collSeen := map[string]bool{}
	out := make([]auditEntry, 0, limit)
	entryKey := func(entry auditEntry) string {
		if entry.ID != "" {
			return entry.ID
		}
		return entry.Time + "|" + entry.Method + "|" + entry.Path + "|" + entry.Actor + "|" + strconv.Itoa(entry.Status) + "|" + entry.Error
	}
	addEntry := func(entry auditEntry, fromColl bool) {
		if connectionID != "" && entry.ConnectionID != connectionID {
			return
		}
		if allow != nil && !allow(entry) {
			return
		}
		key := entryKey(entry)
		if fromColl {
			if collSeen[key] {
				return
			}
			collSeen[key] = true
		} else if collSeen[key] {
			// The coordination copy is authoritative; skip the local mirror.
			return
		}
		out = append(out, entry)
	}
	for _, entry := range combined {
		addEntry(entry, true)
	}
	for i := len(local) - 1; i >= 0; i-- {
		addEntry(local[i], false)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Time > out[j].Time })
	if len(out) > limit {
		out = out[:limit]
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

func (a *API) auditVisible(r *http.Request) func(auditEntry) bool {
	if a.auth == nil || a.auth.IsAdmin(r) {
		return nil
	}
	return func(entry auditEntry) bool {
		return entry.ConnectionID != "" && a.auth.CanAccessConnection(r, entry.ConnectionID)
	}
}

func (a *API) auditConnectionAllowed(w http.ResponseWriter, r *http.Request, connectionID string) bool {
	if connectionID == "" || a.auth == nil || a.auth.IsAdmin(r) || a.auth.CanAccessConnection(r, connectionID) {
		return true
	}
	fail(w, http.StatusForbidden, errConnectionAccess)
	return false
}

func (a *API) listAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	connectionID := r.URL.Query().Get("connectionId")
	if !a.auditConnectionAllowed(w, r, connectionID) {
		return
	}
	ok(w, map[string]any{
		"entries": a.audit.listFiltered(connectionID, limit, a.auditVisible(r)),
	})
}

func (a *API) exportAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > auditCapacity {
		limit = auditCapacity
	}
	connectionID := r.URL.Query().Get("connectionId")
	if !a.auditConnectionAllowed(w, r, connectionID) {
		return
	}
	entries := a.audit.listFiltered(connectionID, limit, a.auditVisible(r))
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

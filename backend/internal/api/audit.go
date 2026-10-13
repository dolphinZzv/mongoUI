package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
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
	Time         string `json:"time"`
	ConnectionID string `json:"connectionId"`
	Database     string `json:"database"`
	Collection   string `json:"collection"`
	Method       string `json:"method"`
	Operation    string `json:"operation"`
	Path         string `json:"path"`
	Status       int    `json:"status"`
}

type auditLog struct {
	mu      sync.Mutex
	entries []auditEntry
	// path is empty when persistence is disabled (e.g. in tests).
	path string
}

// newAuditLog creates a log persisted to <dataDir>/audit.jsonl. An empty
// dataDir keeps it in memory only.
func newAuditLog(dataDir string) *auditLog {
	log := &auditLog{entries: make([]auditEntry, 0, auditCapacity)}
	if dataDir != "" {
		log.path = filepath.Join(dataDir, auditFileName)
		log.load()
	}
	return log
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
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = append(l.entries, entry)
	if len(l.entries) > auditCapacity {
		l.entries = l.entries[len(l.entries)-auditCapacity:]
	}
	l.persist(entry)
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

// auditMiddleware records successful write requests to the data API. Auth and
// self-update endpoints are excluded because they are not data changes.
func (a *API) auditMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if a.audit == nil || !isWriteMethod(r.Method) ||
			strings.Contains(path, "/auth/") || strings.Contains(path, "/update") {
			next.ServeHTTP(w, r)
			return
		}
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		if ww.Status() >= 200 && ww.Status() < 300 {
			a.audit.add(auditEntry{
				ConnectionID: chi.URLParam(r, "id"),
				Database:     chi.URLParam(r, "db"),
				Collection:   chi.URLParam(r, "col"),
				Method:       r.Method,
				Operation:    operationFromPath(path),
				Path:         path,
				Status:       ww.Status(),
			})
		}
	})
}

func (a *API) listAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	ok(w, map[string]any{
		"entries": a.audit.list(r.URL.Query().Get("connectionId"), limit),
	})
}

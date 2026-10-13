package api

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// auditCapacity bounds the in-memory audit ring buffer so it can never grow
// without limit (writes are frequent, entries are small).
const auditCapacity = 1000

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
}

func newAuditLog() *auditLog {
	return &auditLog{entries: make([]auditEntry, 0, auditCapacity)}
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

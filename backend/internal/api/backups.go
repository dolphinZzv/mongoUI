package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	// backupMaxFilesPerTask bounds how many files a task keeps on disk.
	backupMaxFilesPerTask = 5
	backupLimit           = 100000
	backupRunTimeout      = 5 * time.Minute
)

// BackupTask is a scheduled export of one collection to a file.
type BackupTask struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	ConnectionID    string          `json:"connectionId"`
	Database        string          `json:"database"`
	Collection      string          `json:"collection"`
	Format          string          `json:"format"`
	IntervalMinutes int             `json:"intervalMinutes"`
	Enabled         bool            `json:"enabled"`
	Filter          json.RawMessage `json:"filter,omitempty"`
	CreatedAt       string          `json:"createdAt"`
	LastRun         string          `json:"lastRun,omitempty"`
	LastStatus      string          `json:"lastStatus,omitempty"`
	LastError       string          `json:"lastError,omitempty"`
	LastFile        string          `json:"lastFile,omitempty"`
	LastCount       int             `json:"lastCount,omitempty"`
	// Running is a transient, in-memory flag; it is never persisted.
	Running bool `json:"running,omitempty"`
}

// backupManager runs due tasks and records their outcome. It lives for the
// lifetime of the process and stores at most backupMaxFilesPerTask files per
// task, so neither memory nor disk grows without bound.
type backupManager struct {
	mu      sync.Mutex
	path    string
	dir     string
	api     *API
	tasks   []BackupTask
	running map[string]bool
	stop    chan struct{}
	done    chan struct{}
}

func newBackupManager(dataDir string, api *API) *backupManager {
	manager := &backupManager{
		api:     api,
		running: map[string]bool{},
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
	}
	if dataDir != "" {
		manager.path = filepath.Join(dataDir, "backups.json")
		manager.dir = filepath.Join(dataDir, "backups")
		manager.load()
	}
	go manager.loop()
	return manager
}

func (b *backupManager) load() {
	data, err := os.ReadFile(b.path)
	if err != nil {
		return
	}
	var tasks []BackupTask
	if json.Unmarshal(data, &tasks) == nil {
		b.tasks = tasks
	}
}

// saveLocked writes the task list. The caller must hold b.mu.
func (b *backupManager) saveLocked() {
	if b.path == "" {
		return
	}
	data, err := json.MarshalIndent(b.tasks, "", "  ")
	if err != nil {
		return
	}
	tmp := b.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, b.path)
}

func (b *backupManager) loop() {
	defer close(b.done)
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	b.runDue()
	for {
		select {
		case <-b.stop:
			return
		case <-ticker.C:
			b.runDue()
		}
	}
}

// Close stops the scheduler.
func (b *backupManager) Close() {
	close(b.stop)
	<-b.done
}

func (b *backupManager) runDue() {
	b.mu.Lock()
	now := time.Now()
	due := make([]BackupTask, 0)
	for _, task := range b.tasks {
		if !task.Enabled {
			continue
		}
		if task.LastRun != "" {
			if last, err := time.Parse(time.RFC3339, task.LastRun); err == nil &&
				now.Sub(last) < time.Duration(task.IntervalMinutes)*time.Minute {
				continue
			}
		}
		due = append(due, task)
	}
	b.mu.Unlock()
	for _, task := range due {
		b.run(task)
	}
}

func (b *backupManager) run(task BackupTask) {
	// Skip if this task is already running (scheduler + manual trigger).
	b.mu.Lock()
	if b.running == nil {
		b.running = map[string]bool{}
	}
	if b.running[task.ID] {
		b.mu.Unlock()
		return
	}
	b.running[task.ID] = true
	b.mu.Unlock()

	status := "ok"
	errText := ""
	file := ""
	count := 0
	func() {
		ctx, cancel := context.WithTimeout(context.Background(), backupRunTimeout)
		defer cancel()
		if b.dir == "" {
			status, errText = "error", "backup storage is unavailable"
			return
		}
		client, err := b.api.mgr.Get(task.ConnectionID)
		if err != nil {
			status, errText = "error", err.Error()
			return
		}
		filter, err := parseExtJSOND(string(task.Filter))
		if err != nil {
			status, errText = "error", err.Error()
			return
		}
		collection := client.Database(task.Database).Collection(task.Collection)
		ext, content, n, err := buildBackupContent(ctx, collection, task.Format, filter)
		if err != nil {
			status, errText = "error", err.Error()
			return
		}
		count = n
		if err := os.MkdirAll(b.dir, 0o700); err != nil {
			status, errText = "error", err.Error()
			return
		}
		name := fmt.Sprintf("%s.%s.%s.%s", task.ID, sanitizeName(task.Database), sanitizeName(task.Collection), time.Now().UTC().Format("20060102-150405"))
		name = name + "." + ext
		if err := os.WriteFile(filepath.Join(b.dir, name), []byte(content), 0o600); err != nil {
			status, errText = "error", err.Error()
			return
		}
		file = name
		b.prune(task.ID)
	}()

	b.mu.Lock()
	for i := range b.tasks {
		if b.tasks[i].ID != task.ID {
			continue
		}
		b.tasks[i].LastRun = time.Now().UTC().Format(time.RFC3339)
		b.tasks[i].LastStatus = status
		b.tasks[i].LastError = errText
		b.tasks[i].LastFile = file
		b.tasks[i].LastCount = count
	}
	delete(b.running, task.ID)
	b.saveLocked()
	b.mu.Unlock()
}

// prune keeps only the newest backupMaxFilesPerTask files for a task.
func (b *backupManager) prune(taskID string) {
	entries, err := os.ReadDir(b.dir)
	if err != nil {
		return
	}
	names := make([]string, 0)
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasPrefix(entry.Name(), taskID+".") {
			names = append(names, entry.Name())
		}
	}
	if len(names) <= backupMaxFilesPerTask {
		return
	}
	sort.Strings(names)
	for _, name := range names[:len(names)-backupMaxFilesPerTask] {
		_ = os.Remove(filepath.Join(b.dir, name))
	}
}

func sanitizeName(name string) string {
	return strings.NewReplacer("/", "_", "\\", "_", " ", "_").Replace(name)
}

func buildBackupContent(ctx context.Context, collection *mongo.Collection, format string, filter bson.D) (string, string, int, error) {
	if format == "" {
		format = "json"
	}
	cursor, err := collection.Find(ctx, filter, options.Find().SetLimit(backupLimit))
	if err != nil {
		return "", "", 0, err
	}
	defer cursor.Close(ctx)
	docs := []bson.D{}
	if err := cursor.All(ctx, &docs); err != nil {
		return "", "", 0, err
	}
	if format == "csv" {
		content, err := documentsToCSV(docs)
		if err != nil {
			return "", "", 0, err
		}
		return "csv", content, len(docs), nil
	}
	raw, err := toExtJSON(docs)
	if err != nil {
		return "", "", 0, err
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		return "", "", 0, err
	}
	return "json", buf.String(), len(docs), nil
}

// --- HTTP handlers ----------------------------------------------------------

func (a *API) listBackups(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	a.backups.mu.Lock()
	tasks := append([]BackupTask(nil), a.backups.tasks...)
	for i := range tasks {
		tasks[i].Running = a.backups.running[tasks[i].ID]
	}
	a.backups.mu.Unlock()
	ok(w, map[string]any{"tasks": tasks})
}

func (a *API) createBackup(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	var req struct {
		Name            string          `json:"name"`
		ConnectionID    string          `json:"connectionId"`
		Database        string          `json:"database"`
		Collection      string          `json:"collection"`
		Format          string          `json:"format"`
		IntervalMinutes int             `json:"intervalMinutes"`
		Enabled         bool            `json:"enabled"`
		Filter          json.RawMessage `json:"filter"`
	}
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}
	req.Database = strings.TrimSpace(req.Database)
	req.Collection = strings.TrimSpace(req.Collection)
	if strings.TrimSpace(req.ConnectionID) == "" || req.Database == "" || req.Collection == "" {
		badRequest(w, errors.New("connectionId, database and collection are required"))
		return
	}
	format := strings.ToLower(strings.TrimSpace(req.Format))
	if format != "csv" {
		format = "json"
	}
	interval := req.IntervalMinutes
	if interval < 5 {
		interval = 60
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = req.Database + "." + req.Collection
	}
	task := BackupTask{
		ID:              uuid.NewString(),
		Name:            name,
		ConnectionID:    strings.TrimSpace(req.ConnectionID),
		Database:        req.Database,
		Collection:      req.Collection,
		Format:          format,
		IntervalMinutes: interval,
		Enabled:         req.Enabled,
		Filter:          req.Filter,
		CreatedAt:       time.Now().UTC().Format(time.RFC3339),
	}
	a.backups.mu.Lock()
	a.backups.tasks = append(a.backups.tasks, task)
	a.backups.saveLocked()
	a.backups.mu.Unlock()
	ok(w, task)
}

func (a *API) updateBackup(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	var req struct {
		Enabled         *bool `json:"enabled"`
		IntervalMinutes *int  `json:"intervalMinutes"`
	}
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}
	id := chi.URLParam(r, "id")
	a.backups.mu.Lock()
	defer a.backups.mu.Unlock()
	for i := range a.backups.tasks {
		if a.backups.tasks[i].ID != id {
			continue
		}
		if req.Enabled != nil {
			a.backups.tasks[i].Enabled = *req.Enabled
		}
		if req.IntervalMinutes != nil && *req.IntervalMinutes >= 5 {
			a.backups.tasks[i].IntervalMinutes = *req.IntervalMinutes
		}
		a.backups.saveLocked()
		ok(w, a.backups.tasks[i])
		return
	}
	fail(w, http.StatusNotFound, errors.New("backup task not found"))
}

func (a *API) deleteBackup(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	a.backups.mu.Lock()
	defer a.backups.mu.Unlock()
	for i := range a.backups.tasks {
		if a.backups.tasks[i].ID != id {
			continue
		}
		a.backups.tasks = append(a.backups.tasks[:i], a.backups.tasks[i+1:]...)
		a.backups.saveLocked()
		ok(w, map[string]any{"deleted": id})
		return
	}
	fail(w, http.StatusNotFound, errors.New("backup task not found"))
}

func (a *API) runBackup(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	a.backups.mu.Lock()
	var task *BackupTask
	for i := range a.backups.tasks {
		if a.backups.tasks[i].ID == id {
			copied := a.backups.tasks[i]
			task = &copied
			break
		}
	}
	a.backups.mu.Unlock()
	if task == nil {
		fail(w, http.StatusNotFound, errors.New("backup task not found"))
		return
	}
	go a.backups.run(*task)
	ok(w, map[string]any{"started": true})
}

func (a *API) backupTaskExists(id string) bool {
	a.backups.mu.Lock()
	defer a.backups.mu.Unlock()
	for _, task := range a.backups.tasks {
		if task.ID == id {
			return true
		}
	}
	return false
}

// backupFiles lists the files a task has produced, newest first.
func (a *API) backupFiles(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if !a.backupTaskExists(id) {
		fail(w, http.StatusNotFound, errors.New("backup task not found"))
		return
	}
	files := []map[string]any{}
	if a.backups.dir == "" {
		ok(w, map[string]any{"files": files})
		return
	}
	entries, err := os.ReadDir(a.backups.dir)
	if err != nil {
		ok(w, map[string]any{"files": files})
		return
	}
	prefix := id + "."
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), prefix) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, map[string]any{
			"name":     entry.Name(),
			"size":     info.Size(),
			"modified": info.ModTime().UTC().Format(time.RFC3339),
		})
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i]["modified"].(string) > files[j]["modified"].(string)
	})
	ok(w, map[string]any{"files": files})
}

// downloadBackup streams one produced file. The name is validated so it can
// never escape the backups directory.
func (a *API) downloadBackup(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	name := chi.URLParam(r, "file")
	if a.backups.dir == "" || !strings.HasPrefix(name, id+".") ||
		strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
		badRequest(w, errors.New("invalid backup file"))
		return
	}
	path := filepath.Join(a.backups.dir, name)
	file, err := os.Open(path)
	if err != nil {
		fail(w, http.StatusNotFound, errors.New("backup file not found"))
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+name+"\"")
	http.ServeContent(w, r, name, info.ModTime(), file)
}

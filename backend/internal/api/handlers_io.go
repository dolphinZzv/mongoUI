package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	defaultExportLimit = 10000
	maxExportLimit     = 100000
	exportTimeout      = 10 * time.Minute
	importBatchSize    = 1000
)

type exportRequest struct {
	Format     string          `json:"format"`
	Filter     json.RawMessage `json:"filter"`
	Sort       json.RawMessage `json:"sort"`
	Projection json.RawMessage `json:"projection"`
	Limit      int64           `json:"limit"`
}

// documentIterator is the subset of *mongo.Cursor used by the export writers.
// Keeping it narrow makes the streaming/CSV spooling logic unit-testable.
type documentIterator interface {
	Next(context.Context) bool
	Decode(any) error
	Err() error
}

// exportDocuments streams a collection (or a filtered subset) directly to the
// client as a download. Server memory stays bounded even for the maximum
// 100k-document export.
func (a *API) exportDocuments(w http.ResponseWriter, r *http.Request) {
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req exportRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}

	format := strings.ToLower(strings.TrimSpace(req.Format))
	if format == "" {
		format = "json"
	}
	if format != "json" && format != "csv" {
		badRequest(w, errors.New(`format must be "json" or "csv"`))
		return
	}

	filter, err := parseExtJSOND(string(req.Filter))
	if err != nil {
		badRequest(w, err)
		return
	}
	sortDoc, err := parseExtJSOND(string(req.Sort))
	if err != nil {
		badRequest(w, err)
		return
	}
	proj, err := parseExtJSOND(string(req.Projection))
	if err != nil {
		badRequest(w, err)
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = defaultExportLimit
	}
	if limit > maxExportLimit {
		limit = maxExportLimit
	}

	ctx, cancel := context.WithTimeout(r.Context(), exportTimeout)
	defer cancel()

	findOpts := options.Find().SetLimit(limit)
	if len(sortDoc) > 0 {
		findOpts.SetSort(sortDoc)
	}
	if len(proj) > 0 {
		findOpts.SetProjection(proj)
	}

	cursor, err := coll.Find(ctx, filter, findOpts)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	defer cursor.Close(ctx)

	name := exportFilename(chi.URLParam(r, "db"), coll.Name(), format)
	if format == "csv" {
		spool, err := spoolCSVDocuments(ctx, cursor)
		if err != nil {
			serverError(w, err)
			return
		}
		defer spool.Close()
		// Large exports may legitimately outlive the server's global 120s
		// WriteTimeout; the request context still bounds the work.
		_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
		setDownloadHeaders(w, name, "text/csv; charset=utf-8", &spool.count)
		w.WriteHeader(http.StatusOK)
		if err := writeCSVSpool(w, spool); err != nil {
			log.Printf("export csv %s: %v", name, err)
		}
		return
	}

	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	setDownloadHeaders(w, name, "application/json; charset=utf-8", nil)
	w.WriteHeader(http.StatusOK)
	if _, err := writeJSONDocuments(ctx, w, cursor); err != nil {
		log.Printf("export json %s: %v", name, err)
	}
}

func setDownloadHeaders(w http.ResponseWriter, filename, contentType string, count *int) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	w.Header().Set("Cache-Control", "no-store")
	if count != nil {
		w.Header().Set("X-Mongoui-Export-Count", strconv.Itoa(*count))
	}
}

func exportFilename(database, collection, format string) string {
	ext := "json"
	if format == "csv" {
		ext = "csv"
	}
	name := database + "." + collection + "." + ext
	var b strings.Builder
	for _, r := range name {
		if r < 32 || r == 127 || r == '"' || r == '\\' || r == '/' {
			b.WriteByte('_')
		} else {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "export." + ext
	}
	return b.String()
}

// writeJSONDocuments streams a pretty-printed Extended JSON array without
// materialising the full result in memory. The count return value is useful for
// backup bookkeeping; the HTTP response cannot know it before the headers are
// sent.
func writeJSONDocuments(ctx context.Context, w io.Writer, iter documentIterator) (int, error) {
	bw := bufio.NewWriterSize(w, 64<<10)
	if _, err := bw.WriteString("[\n"); err != nil {
		return 0, err
	}
	count := 0
	for iter.Next(ctx) {
		var doc bson.D
		if err := iter.Decode(&doc); err != nil {
			return count, err
		}
		raw, err := toExtJSON(doc)
		if err != nil {
			return count, err
		}
		if count > 0 {
			if _, err := bw.WriteString(",\n"); err != nil {
				return count, err
			}
		}
		if _, err := bw.WriteString("  "); err != nil {
			return count, err
		}
		if _, err := bw.Write(raw); err != nil {
			return count, err
		}
		count++
		if count%256 == 0 {
			if err := bw.Flush(); err != nil {
				return count, err
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}
	if err := iter.Err(); err != nil {
		return count, err
	}
	if _, err := bw.WriteString("\n]\n"); err != nil {
		return count, err
	}
	if err := bw.Flush(); err != nil {
		return count, err
	}
	return count, nil
}

type csvSpool struct {
	path    string
	headers []string
	count   int
}

func (s *csvSpool) Close() {
	if s != nil && s.path != "" {
		_ = os.Remove(s.path)
	}
}

// spoolCSVDocuments reads the cursor once, collecting the union of top-level
// fields so CSV still has a stable header. Row payloads go to a temporary file
// instead of RAM; writeCSVSpool replays them into the HTTP response.
func spoolCSVDocuments(ctx context.Context, iter documentIterator) (*csvSpool, error) {
	file, err := os.CreateTemp("", "mongoui-export-*.ndjson")
	if err != nil {
		return nil, err
	}
	path := file.Name()
	ok := false
	defer func() {
		if !ok {
			_ = file.Close()
			_ = os.Remove(path)
		}
	}()

	bw := bufio.NewWriterSize(file, 64<<10)
	seen := map[string]bool{}
	headers := []string{}
	count := 0
	for iter.Next(ctx) {
		var doc bson.D
		if err := iter.Decode(&doc); err != nil {
			return nil, err
		}
		for _, e := range doc {
			if !seen[e.Key] {
				seen[e.Key] = true
				headers = append(headers, e.Key)
			}
		}
		raw, err := toExtJSON(doc)
		if err != nil {
			return nil, err
		}
		if _, err := bw.Write(raw); err != nil {
			return nil, err
		}
		if err := bw.WriteByte('\n'); err != nil {
			return nil, err
		}
		count++
	}
	if err := iter.Err(); err != nil {
		return nil, err
	}
	if err := bw.Flush(); err != nil {
		return nil, err
	}
	if err := file.Close(); err != nil {
		return nil, err
	}
	ok = true
	return &csvSpool{path: path, headers: orderedCSVHeaders(headers), count: count}, nil
}

func writeCSVSpool(w io.Writer, spool *csvSpool) error {
	file, err := os.Open(spool.path)
	if err != nil {
		return err
	}
	defer file.Close()

	cw := csv.NewWriter(w)
	if err := cw.Write(spool.headers); err != nil {
		return err
	}
	dec := json.NewDecoder(file)
	for {
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return err
		}
		var doc bson.D
		if err := bson.UnmarshalExtJSON(raw, false, &doc); err != nil {
			return err
		}
		m := doc.Map()
		row := make([]string, len(spool.headers))
		for i, header := range spool.headers {
			row[i] = csvCell(m[header])
		}
		if err := cw.Write(row); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

type importRequest struct {
	Format  string `json:"format"`
	Content string `json:"content"`
	Drop    bool   `json:"drop"`
}

// importDocuments inserts documents parsed from JSON (array or NDJSON, Extended
// JSON) or CSV into a collection. When Drop is set the collection is recreated
// first, which doubles as a "restore from backup" flow.
func (a *API) importDocuments(w http.ResponseWriter, r *http.Request) {
	if !a.requireWrite(w, r) {
		return
	}
	coll, err := a.dbCollection(r)
	if err != nil {
		a.dbErr(w, err)
		return
	}
	var req importRequest
	if err := decodeJSON(r, &req); err != nil {
		badRequest(w, err)
		return
	}

	format := strings.ToLower(strings.TrimSpace(req.Format))
	if format == "" {
		format = "json"
	}
	docs, err := parseImportContent(format, req.Content)
	if err != nil {
		badRequest(w, err)
		return
	}
	if len(docs) == 0 {
		badRequest(w, errors.New("no documents found in the input"))
		return
	}

	ctx, cancel := withTimeout(r)
	defer cancel()

	if req.Drop {
		if err := coll.Drop(ctx); err != nil && !isNamespaceNotFound(err) {
			a.dbErr(w, err)
			return
		}
	}

	inserted := 0
	for start := 0; start < len(docs); start += importBatchSize {
		end := start + importBatchSize
		if end > len(docs) {
			end = len(docs)
		}
		batch := make([]any, 0, end-start)
		for _, d := range docs[start:end] {
			batch = append(batch, d)
		}
		if _, err := coll.InsertMany(ctx, batch); err != nil {
			a.dbErr(w, err)
			return
		}
		inserted += end - start
	}

	ok(w, map[string]any{"insertedCount": inserted})
}

// parseImportContent parses the request payload into ordered documents.
func parseImportContent(format, content string) ([]bson.D, error) {
	switch format {
	case "json":
		return parseJSONImport(content)
	case "csv":
		return parseCSVImport(content)
	default:
		return nil, errors.New(`format must be "json" or "csv"`)
	}
}

// parseJSONImport accepts either a single Extended JSON array or newline
// delimited Extended JSON objects (NDJSON).
func parseJSONImport(content string) ([]bson.D, error) {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return nil, nil
	}
	if strings.HasPrefix(trimmed, "[") {
		var docs []bson.D
		if err := bson.UnmarshalExtJSON([]byte(trimmed), false, &docs); err != nil {
			return nil, fmt.Errorf("invalid Extended JSON array: %w", err)
		}
		return docs, nil
	}
	var docs []bson.D
	for _, line := range strings.Split(trimmed, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var d bson.D
		if err := bson.UnmarshalExtJSON([]byte(line), false, &d); err != nil {
			return nil, fmt.Errorf("invalid Extended JSON line %q: %w", line, err)
		}
		if len(d) > 0 {
			docs = append(docs, d)
		}
	}
	return docs, nil
}

// parseCSVImport treats the first row as the header and converts each cell to
// the most specific BSON type it can infer.
func parseCSVImport(content string) ([]bson.D, error) {
	reader := csv.NewReader(strings.NewReader(content))
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true
	records, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("invalid CSV: %w", err)
	}
	if len(records) == 0 {
		return nil, nil
	}
	header := records[0]
	docs := make([]bson.D, 0, len(records)-1)
	for _, row := range records[1:] {
		doc := bson.D{}
		for i, name := range header {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			cell := ""
			if i < len(row) {
				cell = row[i]
			}
			doc = append(doc, bson.E{Key: name, Value: parseCSVCell(cell)})
		}
		docs = append(docs, doc)
	}
	return docs, nil
}

var (
	integerCellPattern = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)$`)
	decimalCellPattern = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$`)
)

// parseCSVCell coerces a CSV cell into a BSON-friendly value. Numbers, booleans,
// null and embedded JSON/Extended JSON objects are recognised; everything else
// stays a string. Leading-zero codes and integers beyond int64 stay strings to
// avoid silent precision loss.
func parseCSVCell(cell string) any {
	s := strings.TrimSpace(cell)
	if s == "" || s == "null" {
		return nil
	}
	switch strings.ToLower(s) {
	case "true":
		return true
	case "false":
		return false
	}
	// Preserve identifiers such as leading-zero codes and integers that do not
	// fit in int64 instead of silently turning them into lossy float64 values.
	if integerCellPattern.MatchString(s) {
		if i, err := strconv.ParseInt(s, 10, 64); err == nil {
			return i
		}
		return cell
	}
	if decimalCellPattern.MatchString(s) {
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			return f
		}
	}
	if strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}") ||
		strings.HasPrefix(s, "[") && strings.HasSuffix(s, "]") {
		var v any
		if err := bson.UnmarshalExtJSON([]byte(s), false, &v); err == nil {
			return v
		}
	}
	return cell
}

// documentsToCSV flattens the top level fields of the documents into CSV.
func documentsToCSV(docs []bson.D) (string, error) {
	headers := csvHeaders(docs)
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if err := w.Write(headers); err != nil {
		return "", err
	}
	for _, doc := range docs {
		m := doc.Map()
		row := make([]string, len(headers))
		for i, h := range headers {
			row[i] = csvCell(m[h])
		}
		if err := w.Write(row); err != nil {
			return "", err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func csvHeaders(docs []bson.D) []string {
	seen := map[string]bool{}
	headers := []string{}
	for _, doc := range docs {
		for _, e := range doc {
			if !seen[e.Key] {
				seen[e.Key] = true
				headers = append(headers, e.Key)
			}
		}
	}
	return orderedCSVHeaders(headers)
}

// orderedCSVHeaders keeps the first-seen order but puts _id first.
func orderedCSVHeaders(headers []string) []string {
	for i, h := range headers {
		if h == "_id" && i != 0 {
			out := make([]string, 0, len(headers))
			out = append(out, "_id")
			out = append(out, headers[:i]...)
			out = append(out, headers[i+1:]...)
			return out
		}
	}
	return headers
}

// csvCell renders a BSON value as a single CSV cell. Common scalar types are
// rendered naturally (ObjectId hex, ISO dates, ...); nested values become
// compact Extended JSON.
func csvCell(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case int:
		return strconv.Itoa(t)
	case int32:
		return strconv.FormatInt(int64(t), 10)
	case int64:
		return strconv.FormatInt(t, 10)
	case float32:
		return strconv.FormatFloat(float64(t), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case primitive.ObjectID:
		return t.Hex()
	case primitive.DateTime:
		return t.Time().UTC().Format(time.RFC3339Nano)
	case primitive.Decimal128:
		return t.String()
	case primitive.Binary:
		return base64.StdEncoding.EncodeToString(t.Data)
	case primitive.Timestamp:
		return strconv.FormatUint(uint64(t.T), 10)
	case time.Time:
		return t.UTC().Format(time.RFC3339Nano)
	default:
		if raw, err := toExtJSON(v); err == nil {
			return string(raw)
		}
		return fmt.Sprint(v)
	}
}

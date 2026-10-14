package mongoscript

import (
	"context"
	"fmt"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Result is the outcome of a single executed statement.
type Result struct {
	Statement string
	OK        bool
	Error     string
	// Kind is one of "documents" (Documents is set), "value" (Value is set),
	// "write" (Value holds an acknowledgement), or "ack".
	Kind      string
	Documents []bson.D
	Value     any
	Count     int64
}

// Runner executes parsed statements against one database.
type Runner struct {
	DB           *mongo.Database
	DefaultLimit int64
	MaxLimit     int64
}

// writeMethods are the collection/database helpers that modify data or schema.
var writeMethods = map[string]bool{
	"insertOne": true, "insertMany": true,
	"updateOne": true, "updateMany": true, "replaceOne": true,
	"deleteOne": true, "deleteMany": true,
	"findOneAndUpdate": true, "findOneAndReplace": true, "findOneAndDelete": true,
	"createIndex": true, "dropIndex": true, "dropIndexes": true,
	"drop": true, "renameCollection": true, "createCollection": true,
	"dropDatabase": true,
}

// IsWrite reports whether a script performs any write, including $out/$merge
// aggregation stages.
func IsWrite(stmts []Statement) bool {
	for _, stmt := range stmts {
		for _, call := range stmt.Calls {
			if writeMethods[call.Name] {
				return true
			}
			if call.Name == "aggregate" && pipelineWrites(call.Args) {
				return true
			}
		}
	}
	return false
}

func pipelineWrites(args []any) bool {
	if len(args) == 0 {
		return false
	}
	stages, ok := args[0].([]any)
	if !ok {
		return false
	}
	for _, stage := range stages {
		if doc, ok := stage.(bson.D); ok {
			for _, e := range doc {
				if e.Key == "$out" || e.Key == "$merge" {
					return true
				}
			}
		}
	}
	return false
}

// Run executes every statement in order and stops at the first error.
func (r *Runner) Run(ctx context.Context, stmts []Statement) []Result {
	results := make([]Result, 0, len(stmts))
	currentDB := ""
	for _, stmt := range stmts {
		res := r.runStatement(ctx, &currentDB, stmt)
		results = append(results, res)
		if !res.OK {
			break
		}
	}
	return results
}

func (r *Runner) runStatement(ctx context.Context, currentDB *string, stmt Statement) Result {
	res := Result{Statement: stmt.Source, OK: true}

	if stmt.Kind == "use" {
		*currentDB = stmt.Use
		res.Kind = "ack"
		res.Value = map[string]any{"database": stmt.Use}
		return res
	}

	dbName := stmt.Database
	if dbName == "" {
		dbName = *currentDB
	}
	db := r.DB
	if dbName != "" && dbName != r.DB.Name() {
		db = r.DB.Client().Database(dbName)
	}
	*currentDB = db.Name()

	source := stmt.Calls[0]
	rest := stmt.Calls[1:]
	var err error
	if stmt.Collection == "" {
		err = r.runDatabase(ctx, db, source, rest, &res)
	} else {
		err = r.runCollection(ctx, db, stmt.Collection, source, rest, &res)
	}
	if err != nil {
		res.OK = false
		res.Error = err.Error()
		res.Kind = ""
		res.Documents = nil
		res.Value = nil
	}
	return res
}

// --- database-level calls ---------------------------------------------------

func (r *Runner) runDatabase(ctx context.Context, db *mongo.Database, source Call, rest []Call, res *Result) error {
	switch source.Name {
	case "getCollectionNames":
		names, err := db.ListCollectionNames(ctx, argDoc(source.Args, 0))
		if err != nil {
			return err
		}
		res.Kind = "value"
		res.Value = names
	case "getCollectionInfos":
		cursor, err := db.ListCollections(ctx, argDoc(source.Args, 0))
		if err != nil {
			return err
		}
		return collectDocuments(ctx, cursor, res)
	case "stats":
		var doc bson.D
		if err := db.RunCommand(ctx, bson.D{{Key: "dbStats", Value: 1}}).Decode(&doc); err != nil {
			return err
		}
		res.Kind = "value"
		res.Value = doc
	case "createCollection":
		name, ok := firstStringArg(source.Args)
		if !ok {
			return fmt.Errorf("createCollection() expects a name")
		}
		opts := options.CreateCollection()
		if doc := argDoc(source.Args, 1); doc != nil {
			for _, e := range doc {
				switch e.Key {
				case "capped":
					if v, ok := e.Value.(bool); ok {
						opts.SetCapped(v)
					}
				case "size":
					opts.SetSizeInBytes(toInt64([]any{e.Value}, 0))
				case "max":
					opts.SetMaxDocuments(toInt64([]any{e.Value}, 0))
				}
			}
		}
		if err := db.CreateCollection(ctx, name, opts); err != nil {
			return err
		}
		res.Kind = "ack"
		res.Value = map[string]any{"ok": true, "collection": name}
	case "dropDatabase":
		if err := db.Drop(ctx); err != nil {
			return err
		}
		res.Kind = "ack"
		res.Value = map[string]any{"ok": true, "dropped": db.Name()}
	case "version":
		var info bson.D
		if err := db.RunCommand(ctx, bson.D{{Key: "buildInfo", Value: 1}}).Decode(&info); err != nil {
			return err
		}
		res.Kind = "value"
		res.Value = info
	default:
		return fmt.Errorf("unsupported database method db.%s()", source.Name)
	}
	return nil
}

// --- collection calls -------------------------------------------------------

func (r *Runner) runCollection(ctx context.Context, db *mongo.Database, name string, source Call, rest []Call, res *Result) error {
	coll := db.Collection(name)
	switch source.Name {
	case "find":
		return r.runFind(ctx, coll, source.Args, rest, res)
	case "findOne":
		filter := argDocOrEmpty(source.Args, 0)
		opts := options.FindOne()
		if proj := argDoc(source.Args, 1); proj != nil {
			opts.SetProjection(proj)
		}
		var doc bson.D
		err := coll.FindOne(ctx, filter, opts).Decode(&doc)
		if err == mongo.ErrNoDocuments {
			res.Kind = "documents"
			res.Documents = []bson.D{}
			return nil
		}
		if err != nil {
			return err
		}
		res.Kind = "documents"
		res.Documents = []bson.D{doc}
		res.Count = 1
		return nil
	case "countDocuments", "count":
		n, err := coll.CountDocuments(ctx, argDocOrEmpty(source.Args, 0))
		if err != nil {
			return err
		}
		res.Kind = "value"
		res.Value = n
	case "estimatedDocumentCount":
		n, err := coll.EstimatedDocumentCount(ctx)
		if err != nil {
			return err
		}
		res.Kind = "value"
		res.Value = n
	case "distinct":
		field, ok := firstStringArg(source.Args)
		if !ok {
			return fmt.Errorf("distinct() expects a field name")
		}
		values, err := coll.Distinct(ctx, field, argDocOrEmpty(source.Args, 1))
		if err != nil {
			return err
		}
		res.Kind = "value"
		res.Value = values
	case "aggregate":
		return r.runAggregate(ctx, coll, source.Args, rest, res)
	case "insertOne":
		doc, err := argDocStrict(source.Args, 0, "insertOne")
		if err != nil {
			return err
		}
		out, err := coll.InsertOne(ctx, doc)
		if err != nil {
			return err
		}
		res.Kind = "write"
		res.Value = map[string]any{"acknowledged": true, "insertedId": out.InsertedID}
	case "insertMany":
		docs, err := argDocs(source.Args, 0, "insertMany")
		if err != nil {
			return err
		}
		out, err := coll.InsertMany(ctx, docs, options.InsertMany().SetOrdered(true))
		if err != nil {
			return err
		}
		res.Kind = "write"
		res.Value = map[string]any{"acknowledged": true, "insertedIds": out.InsertedIDs}
	case "updateOne", "updateMany", "replaceOne":
		return r.runUpdate(ctx, coll, source, res)
	case "deleteOne", "deleteMany":
		filter := argDocOrEmpty(source.Args, 0)
		var out *mongo.DeleteResult
		var err error
		if source.Name == "deleteMany" {
			out, err = coll.DeleteMany(ctx, filter)
		} else {
			out, err = coll.DeleteOne(ctx, filter)
		}
		if err != nil {
			return err
		}
		res.Kind = "write"
		res.Value = map[string]any{"acknowledged": true, "deletedCount": out.DeletedCount}
	case "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete":
		return r.runFindAndModify(ctx, coll, source, res)
	case "createIndex":
		keys, err := argDocStrict(source.Args, 0, "createIndex")
		if err != nil {
			return err
		}
		idxOpts, err := buildIndexOptions(argDoc(source.Args, 1))
		if err != nil {
			return err
		}
		idxName, err := coll.Indexes().CreateOne(ctx, mongo.IndexModel{Keys: keys, Options: idxOpts})
		if err != nil {
			return err
		}
		res.Kind = "write"
		res.Value = map[string]any{"name": idxName}
	case "dropIndex":
		idxName, ok := firstStringArg(source.Args)
		if !ok {
			return fmt.Errorf("dropIndex() expects an index name")
		}
		if _, err := coll.Indexes().DropOne(ctx, idxName); err != nil {
			return err
		}
		res.Kind = "write"
		res.Value = map[string]any{"dropped": idxName}
	case "dropIndexes":
		if _, err := coll.Indexes().DropAll(ctx); err != nil {
			return err
		}
		res.Kind = "write"
		res.Value = map[string]any{"ok": true}
	case "drop":
		if err := coll.Drop(ctx); err != nil {
			return err
		}
		res.Kind = "write"
		res.Value = map[string]any{"ok": true, "dropped": name}
	case "renameCollection":
		newName, ok := firstStringArg(source.Args)
		if !ok {
			return fmt.Errorf("renameCollection() expects a new name")
		}
		admin := db.Client().Database("admin")
		if err := admin.RunCommand(ctx, bson.D{
			{Key: "renameCollection", Value: db.Name() + "." + name},
			{Key: "to", Value: db.Name() + "." + newName},
		}).Err(); err != nil {
			return err
		}
		res.Kind = "write"
		res.Value = map[string]any{"ok": true, "collection": newName}
	case "stats":
		var doc bson.D
		if err := db.RunCommand(ctx, bson.D{{Key: "collStats", Value: name}}).Decode(&doc); err != nil {
			return err
		}
		res.Kind = "value"
		res.Value = doc
	case "indexes", "getIndexes":
		cursor, err := coll.Indexes().List(ctx)
		if err != nil {
			return err
		}
		return collectDocuments(ctx, cursor, res)
	default:
		return fmt.Errorf("unsupported collection method %s()", source.Name)
	}
	return nil
}

func (r *Runner) runFind(ctx context.Context, coll *mongo.Collection, args []any, rest []Call, res *Result) error {
	filter := argDocOrEmpty(args, 0)
	opts := options.Find()
	if proj := argDoc(args, 1); proj != nil {
		opts.SetProjection(proj)
	}
	limitSet := false
	for _, call := range rest {
		switch call.Name {
		case "sort":
			spec, err := argDocStrict(call.Args, 0, "sort")
			if err != nil {
				return err
			}
			opts.SetSort(spec)
		case "skip":
			opts.SetSkip(toInt64(call.Args, 0))
		case "limit":
			opts.SetLimit(toInt64(call.Args, 0))
			limitSet = true
		case "projection":
			spec, err := argDocStrict(call.Args, 0, "projection")
			if err != nil {
				return err
			}
			opts.SetProjection(spec)
		case "count":
			n, err := coll.CountDocuments(ctx, filter)
			if err != nil {
				return err
			}
			res.Kind = "value"
			res.Value = n
			return nil
		case "toArray", "pretty":
			// No-op: results are always materialised.
		default:
			return fmt.Errorf("unsupported method %s() after find()", call.Name)
		}
	}
	if !limitSet {
		opts.SetLimit(r.limit())
	}
	cursor, err := coll.Find(ctx, filter, opts)
	if err != nil {
		return err
	}
	return collectDocuments(ctx, cursor, res)
}

func (r *Runner) runAggregate(ctx context.Context, coll *mongo.Collection, args []any, rest []Call, res *Result) error {
	if len(args) == 0 {
		return fmt.Errorf("aggregate() expects a pipeline array")
	}
	pipeline, err := toPipeline(args[0])
	if err != nil {
		return err
	}
	terminal := false
	for _, stage := range pipeline {
		for _, e := range stage {
			if e.Key == "$out" || e.Key == "$merge" {
				terminal = true
			}
		}
	}
	limitSet := terminal
	for _, call := range rest {
		switch call.Name {
		case "limit":
			pipeline = append(pipeline, bson.D{{Key: "$limit", Value: toInt64(call.Args, 0)}})
			limitSet = true
		case "skip":
			pipeline = append(pipeline, bson.D{{Key: "$skip", Value: toInt64(call.Args, 0)}})
		case "toArray", "pretty":
			// No-op.
		default:
			return fmt.Errorf("unsupported method %s() after aggregate()", call.Name)
		}
	}
	if !limitSet {
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: r.limit()}})
	}
	cursor, err := coll.Aggregate(ctx, pipeline)
	if err != nil {
		return err
	}
	return collectDocuments(ctx, cursor, res)
}

func (r *Runner) runUpdate(ctx context.Context, coll *mongo.Collection, source Call, res *Result) error {
	filter := argDocOrEmpty(source.Args, 0)
	update, err := argDocStrict(source.Args, 1, source.Name)
	if err != nil {
		return err
	}
	upsert := false
	if opts := argDoc(source.Args, 2); opts != nil {
		for _, e := range opts {
			if e.Key == "upsert" {
				upsert, _ = e.Value.(bool)
			}
		}
	}
	opts := options.Update().SetUpsert(upsert)
	var out *mongo.UpdateResult
	switch source.Name {
	case "replaceOne":
		replaceOpts := options.Replace().SetUpsert(upsert)
		rr, err := coll.ReplaceOne(ctx, filter, update, replaceOpts)
		if err != nil {
			return err
		}
		res.Kind = "write"
		res.Value = updateAck(rr.MatchedCount, rr.ModifiedCount, rr.UpsertedCount, rr.UpsertedID)
		return nil
	case "updateMany":
		out, err = coll.UpdateMany(ctx, filter, update, opts)
	default:
		out, err = coll.UpdateOne(ctx, filter, update, opts)
	}
	if err != nil {
		return err
	}
	res.Kind = "write"
	res.Value = updateAck(out.MatchedCount, out.ModifiedCount, out.UpsertedCount, out.UpsertedID)
	return nil
}

func updateAck(matched, modified, upserted int64, id any) map[string]any {
	ack := map[string]any{
		"acknowledged":  true,
		"matchedCount":  matched,
		"modifiedCount": modified,
		"upsertedCount": upserted,
	}
	if id != nil {
		ack["upsertedId"] = id
	}
	return ack
}

func (r *Runner) runFindAndModify(ctx context.Context, coll *mongo.Collection, source Call, res *Result) error {
	filter := argDocOrEmpty(source.Args, 0)
	var doc bson.D
	var err error
	switch source.Name {
	case "findOneAndDelete":
		err = coll.FindOneAndDelete(ctx, filter).Decode(&doc)
	case "findOneAndReplace":
		replacement, rerr := argDocStrict(source.Args, 1, source.Name)
		if rerr != nil {
			return rerr
		}
		err = coll.FindOneAndReplace(ctx, filter, replacement).Decode(&doc)
	default:
		update, uerr := argDocStrict(source.Args, 1, source.Name)
		if uerr != nil {
			return uerr
		}
		err = coll.FindOneAndUpdate(ctx, filter, update).Decode(&doc)
	}
	if err == mongo.ErrNoDocuments {
		res.Kind = "value"
		res.Value = nil
		return nil
	}
	if err != nil {
		return err
	}
	res.Kind = "value"
	res.Value = doc
	return nil
}

func buildIndexOptions(doc bson.D) (*options.IndexOptions, error) {
	if doc == nil {
		return nil, nil
	}
	opts := options.Index()
	for _, e := range doc {
		switch e.Key {
		case "name":
			if s, ok := e.Value.(string); ok {
				opts.SetName(s)
			}
		case "unique":
			if v, ok := e.Value.(bool); ok {
				opts.SetUnique(v)
			}
		case "sparse":
			if v, ok := e.Value.(bool); ok {
				opts.SetSparse(v)
			}
		case "hidden":
			if v, ok := e.Value.(bool); ok {
				opts.SetHidden(v)
			}
		case "background":
			if v, ok := e.Value.(bool); ok {
				opts.SetBackground(v)
			}
		case "expireAfterSeconds":
			opts.SetExpireAfterSeconds(int32(toInt64([]any{e.Value}, 0)))
		case "partialFilterExpression":
			if d, ok := e.Value.(bson.D); ok {
				opts.SetPartialFilterExpression(d)
			}
		case "collation":
			if d, ok := e.Value.(bson.D); ok {
				opts.SetCollation(collationFromDoc(d))
			}
		case "weights":
			if d, ok := e.Value.(bson.D); ok {
				opts.SetWeights(weightsFromDoc(d))
			}
		case "default_language":
			if s, ok := e.Value.(string); ok {
				opts.SetDefaultLanguage(s)
			}
		case "language_override":
			if s, ok := e.Value.(string); ok {
				opts.SetLanguageOverride(s)
			}
		default:
			return nil, fmt.Errorf("unsupported index option %q", e.Key)
		}
	}
	return opts, nil
}

func collationFromDoc(doc bson.D) *options.Collation {
	c := &options.Collation{}
	for _, e := range doc {
		switch e.Key {
		case "locale":
			c.Locale, _ = e.Value.(string)
		case "caseLevel":
			c.CaseLevel, _ = e.Value.(bool)
		case "caseFirst":
			c.CaseFirst, _ = e.Value.(string)
		case "strength":
			c.Strength = int(toInt64([]any{e.Value}, 0))
		case "numericOrdering":
			c.NumericOrdering, _ = e.Value.(bool)
		case "alternate":
			c.Alternate, _ = e.Value.(string)
		case "maxVariable":
			c.MaxVariable, _ = e.Value.(string)
		case "normalization":
			c.Normalization, _ = e.Value.(bool)
		case "backwards":
			c.Backwards, _ = e.Value.(bool)
		}
	}
	return c
}

func weightsFromDoc(doc bson.D) bson.D {
	out := bson.D{}
	for _, e := range doc {
		out = append(out, e)
	}
	return out
}

// --- helpers ----------------------------------------------------------------

func (r *Runner) limit() int64 {
	limit := r.DefaultLimit
	if limit <= 0 {
		limit = 50
	}
	if r.MaxLimit > 0 && limit > r.MaxLimit {
		limit = r.MaxLimit
	}
	return limit
}

func collectDocuments(ctx context.Context, cursor *mongo.Cursor, res *Result) error {
	defer cursor.Close(ctx)
	docs := []bson.D{}
	if err := cursor.All(ctx, &docs); err != nil {
		return err
	}
	res.Kind = "documents"
	res.Documents = docs
	res.Count = int64(len(docs))
	return nil
}

func toPipeline(v any) (mongo.Pipeline, error) {
	arr, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("aggregate() expects a pipeline array")
	}
	pipeline := make(mongo.Pipeline, 0, len(arr))
	for i, stage := range arr {
		doc, ok := stage.(bson.D)
		if !ok {
			return nil, fmt.Errorf("aggregate() stage %d is not an object", i)
		}
		pipeline = append(pipeline, doc)
	}
	return pipeline, nil
}

func argDoc(args []any, i int) bson.D {
	if i >= len(args) {
		return nil
	}
	doc, ok := args[i].(bson.D)
	if !ok {
		return nil
	}
	return doc
}

func argDocOrEmpty(args []any, i int) bson.D {
	if doc := argDoc(args, i); doc != nil {
		return doc
	}
	return bson.D{}
}

func argDocStrict(args []any, i int, method string) (bson.D, error) {
	doc := argDoc(args, i)
	if doc == nil {
		return nil, fmt.Errorf("%s() expects an object argument", method)
	}
	return doc, nil
}

func argDocs(args []any, i int, method string) ([]any, error) {
	if i >= len(args) {
		return nil, fmt.Errorf("%s() expects an array of documents", method)
	}
	arr, ok := args[i].([]any)
	if !ok {
		return nil, fmt.Errorf("%s() expects an array of documents", method)
	}
	if len(arr) == 0 {
		return nil, fmt.Errorf("%s() received an empty array", method)
	}
	return arr, nil
}

// Summary returns a short description of the operations in a script, used by
// the UI to show what will run.
func Summary(stmts []Statement) string {
	parts := make([]string, 0, len(stmts))
	for _, stmt := range stmts {
		if stmt.Kind == "use" {
			parts = append(parts, "use "+stmt.Use)
			continue
		}
		name := "db"
		if stmt.Collection != "" {
			name += "." + stmt.Collection
		}
		if len(stmt.Calls) > 0 {
			name += "." + stmt.Calls[0].Name
		}
		parts = append(parts, name)
	}
	return strings.Join(parts, "; ")
}

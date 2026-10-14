package mongoscript

import (
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestParseFindChain(t *testing.T) {
	stmts, err := Parse(`db.users.find({ status: "active", age: { $gte: 18 } }).sort({ age: -1 }).limit(20)`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(stmts) != 1 {
		t.Fatalf("expected 1 statement, got %d", len(stmts))
	}
	stmt := stmts[0]
	if stmt.Collection != "users" {
		t.Fatalf("collection = %q", stmt.Collection)
	}
	if len(stmt.Calls) != 3 {
		t.Fatalf("calls = %d, want 3", len(stmt.Calls))
	}
	if stmt.Calls[0].Name != "find" || stmt.Calls[1].Name != "sort" || stmt.Calls[2].Name != "limit" {
		t.Fatalf("unexpected calls: %+v", stmt.Calls)
	}
	filter, ok := stmt.Calls[0].Args[0].(bson.D)
	if !ok {
		t.Fatalf("filter type = %T", stmt.Calls[0].Args[0])
	}
	if len(filter) != 2 || filter[0].Key != "status" || filter[0].Value != "active" {
		t.Fatalf("unexpected filter: %+v", filter)
	}
	if got := toInt64(stmt.Calls[2].Args, 0); got != 20 {
		t.Fatalf("limit = %d, want 20", got)
	}
}

func TestParseValuesAndConstructors(t *testing.T) {
	stmts, err := Parse(`db.users.insertOne({ _id: ObjectId("507f1f77bcf86cd799439011"), at: ISODate("2024-01-02T03:04:05Z"), n: NumberLong("9007199254740993"), p: NumberDecimal("1.50"), tags: ["a", "b"], ok: true, missing: null })`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	doc, ok := stmts[0].Calls[0].Args[0].(bson.D)
	if !ok {
		t.Fatalf("doc type = %T", stmts[0].Calls[0].Args[0])
	}
	values := map[string]any{}
	for _, e := range doc {
		values[e.Key] = e.Value
	}
	if _, ok := values["_id"].(primitive.ObjectID); !ok {
		t.Fatalf("_id = %T, want ObjectID", values["_id"])
	}
	if _, ok := values["at"].(time.Time); !ok {
		t.Fatalf("at = %T, want time.Time", values["at"])
	}
	if v, ok := values["n"].(int64); !ok || v != 9007199254740993 {
		t.Fatalf("n = %v (%T)", values["n"], values["n"])
	}
	if _, ok := values["p"].(primitive.Decimal128); !ok {
		t.Fatalf("p = %T, want Decimal128", values["p"])
	}
	if v, ok := values["tags"].([]any); !ok || len(v) != 2 {
		t.Fatalf("tags = %v", values["tags"])
	}
}

func TestParseUseAndGetCollection(t *testing.T) {
	stmts, err := Parse("use shop\ndb.getCollection(\"orders\").countDocuments({ paid: true })")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(stmts) != 2 {
		t.Fatalf("statements = %d", len(stmts))
	}
	if stmts[0].Kind != "use" || stmts[0].Use != "shop" {
		t.Fatalf("use stmt = %+v", stmts[0])
	}
	if stmts[1].Collection != "orders" || stmts[1].Calls[0].Name != "countDocuments" {
		t.Fatalf("getCollection stmt = %+v", stmts[1])
	}
}

func TestParseSiblingDB(t *testing.T) {
	stmts, err := Parse(`db.getSiblingDB("analytics").events.aggregate([{ $match: { type: "click" } }])`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if stmts[0].Database != "analytics" || stmts[0].Collection != "events" {
		t.Fatalf("stmt = %+v", stmts[0])
	}
}

func TestParseErrors(t *testing.T) {
	cases := []string{
		`const x = 1`,
		`db.users.find({ status: active })`,
		`db.users.find({`,
		`db.users`,
	}
	for _, input := range cases {
		if _, err := Parse(input); err == nil {
			t.Errorf("expected error for %q", input)
		}
	}
}

func TestIsWrite(t *testing.T) {
	writes := []string{
		`db.users.insertOne({ a: 1 })`,
		`db.users.deleteMany({})`,
		`db.users.updateOne({ a: 1 }, { $set: { b: 2 } })`,
		`db.users.aggregate([{ $match: {} }, { $out: "copy" }])`,
		`db.users.createIndex({ email: 1 })`,
		`db.dropDatabase()`,
	}
	for _, input := range writes {
		stmts, err := Parse(input)
		if err != nil {
			t.Fatalf("parse %q: %v", input, err)
		}
		if !IsWrite(stmts) {
			t.Errorf("expected %q to be a write", input)
		}
	}
	reads := []string{
		`db.users.find({})`,
		`db.users.aggregate([{ $match: {} }])`,
		`db.users.countDocuments({})`,
		`db.getCollectionNames()`,
	}
	for _, input := range reads {
		stmts, err := Parse(input)
		if err != nil {
			t.Fatalf("parse %q: %v", input, err)
		}
		if IsWrite(stmts) {
			t.Errorf("expected %q to be read-only", input)
		}
	}
}

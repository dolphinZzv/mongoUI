package api

import (
	"errors"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func TestParseJSONImportArray(t *testing.T) {
	docs, err := parseJSONImport(`[{"a": 1}, {"b": {"$oid": "507f1f77bcf86cd799439011"}}]`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(docs) != 2 {
		t.Fatalf("expected 2 docs, got %d", len(docs))
	}
	if docs[0][0].Key != "a" || docs[1][0].Key != "b" {
		t.Fatalf("unexpected docs: %+v", docs)
	}
}

func TestParseJSONImportNDJSON(t *testing.T) {
	docs, err := parseJSONImport("{\"a\": 1}\n\n{\"b\": 2}\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(docs) != 2 {
		t.Fatalf("expected 2 docs, got %d", len(docs))
	}
}

func TestParseJSONImportEmpty(t *testing.T) {
	docs, err := parseJSONImport("   ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(docs) != 0 {
		t.Fatalf("expected no docs, got %d", len(docs))
	}
}

func TestParseJSONImportInvalid(t *testing.T) {
	if _, err := parseJSONImport("[{not json}]"); err == nil {
		t.Fatal("expected an error for invalid JSON")
	}
}

func TestParseCSVCell(t *testing.T) {
	cases := []struct {
		in   string
		want any
	}{
		{"", nil},
		{"null", nil},
		{"true", true},
		{"false", false},
		{"42", int64(42)},
		{"3.5", 3.5},
		{"hello", "hello"},
		{"  spaced  ", "  spaced  "},
		{`{"nested":1}`, bson.D{{Key: "nested", Value: int32(1)}}},
	}
	for _, tc := range cases {
		got := parseCSVCell(tc.in)
		if !valuesEqual(got, tc.want) {
			t.Errorf("parseCSVCell(%q) = %#v, want %#v", tc.in, got, tc.want)
		}
	}
}

func valuesEqual(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	switch av := a.(type) {
	case bson.D:
		bv, ok := b.(bson.D)
		if !ok || len(av) != len(bv) {
			return false
		}
		for i := range av {
			if av[i].Key != bv[i].Key || !valuesEqual(av[i].Value, bv[i].Value) {
				return false
			}
		}
		return true
	case int64:
		bv, ok := b.(int64)
		return ok && av == bv
	case float64:
		bv, ok := b.(float64)
		return ok && av == bv
	default:
		return a == b
	}
}

func TestParseCSVImport(t *testing.T) {
	content := "name,age,active\nAlice,30,true\nBob,25,false\n"
	docs, err := parseCSVImport(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(docs) != 2 {
		t.Fatalf("expected 2 docs, got %d", len(docs))
	}
	if docs[0][0].Key != "name" || docs[0][0].Value != "Alice" {
		t.Fatalf("unexpected first cell: %+v", docs[0][0])
	}
	if docs[0][1].Value != int64(30) {
		t.Fatalf("expected age int64, got %#v", docs[0][1].Value)
	}
	if docs[1][2].Value != false {
		t.Fatalf("expected active false, got %#v", docs[1][2].Value)
	}
}

func TestDocumentsToCSV(t *testing.T) {
	docs := []bson.D{
		{{Key: "name", Value: "Alice"}, {Key: "_id", Value: int32(1)}},
		{{Key: "_id", Value: int32(2)}, {Key: "extra", Value: true}},
	}
	out, err := documentsToCSV(docs)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if lines[0] != "_id,name,extra" {
		t.Fatalf("unexpected header: %q", lines[0])
	}
	if lines[1] != "1,Alice," {
		t.Fatalf("unexpected first row: %q", lines[1])
	}
	if lines[2] != "2,,true" {
		t.Fatalf("unexpected second row: %q", lines[2])
	}
}

func TestParsePipeline(t *testing.T) {
	stages, err := parsePipeline([]byte(`[{"$match": {"a": 1}}]`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(stages) != 1 || stages[0][0].Key != "$match" {
		t.Fatalf("unexpected stages: %+v", stages)
	}

	empty, err := parsePipeline(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("expected empty pipeline, got %+v", empty)
	}

	if _, err := parsePipeline([]byte(`{"not": "array"}`)); err == nil {
		t.Fatal("expected an error for a non-array pipeline")
	}
}

func TestIsNamespaceNotFound(t *testing.T) {
	if !isNamespaceNotFound(errors.New("ns not found")) {
		t.Fatal("expected plain 'ns not found' error to match")
	}
	if isNamespaceNotFound(nil) {
		t.Fatal("nil error must not match")
	}
	if isNamespaceNotFound(errors.New("some other error")) {
		t.Fatal("unrelated error must not match")
	}
}

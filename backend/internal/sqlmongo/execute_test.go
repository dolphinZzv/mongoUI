package sqlmongo

import (
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func TestCrossDBFilterProjectionAndSort(t *testing.T) {
	row := bson.D{
		{Key: "_id", Value: int32(1)},
		{Key: "name", Value: "Ada"},
		{Key: "o", Value: bson.D{{Key: "total", Value: int32(120)}, {Key: "region", Value: "EU"}}},
	}
	filter := bson.D{{Key: "o.total", Value: bson.D{{Key: "$gt", Value: int32(100)}}}}
	if !matchFilter(row, filter) {
		t.Fatal("filter should match joined field")
	}
	if matchFilter(row, bson.D{{Key: "o.region", Value: bson.D{{Key: "$in", Value: bson.A{"US"}}}}}) {
		t.Fatal("unexpected region match")
	}
	if !matchFilter(row, bson.D{{Key: "$expr", Value: bson.D{{Key: "$gt", Value: bson.A{"$o.total", 100}}}}}) {
		t.Fatal("$expr should compare joined fields")
	}

	projected := projectRow(row, []SelectItem{
		{Expr: &ColumnRef{Name: "name"}},
		{Expr: &ColumnRef{Name: "o.total"}},
	})
	got := extJSON(t, bson.D{{Key: "p", Value: projected}})
	if got != `{"p":{"name":"Ada","o_total":120}}` {
		t.Fatalf("projection = %s", got)
	}

	rows := []bson.D{
		{{Key: "o_total", Value: int32(2)}},
		{{Key: "o_total", Value: int32(1)}},
	}
	sortRows(rows, []OrderItem{{Expr: &ColumnRef{Name: "o.total"}}}, []SelectItem{
		{Expr: &ColumnRef{Name: "o.total"}},
	})
	if rows[0][0].Value != int32(1) {
		t.Fatalf("sort order = %#v", rows)
	}
}

func TestJoinAliasPath(t *testing.T) {
	row := bson.D{{Key: "o", Value: bson.D{{Key: "user", Value: bson.D{{Key: "id", Value: int32(7)}}}}}}
	if got := pathValue(row, "o.user.id"); got != int32(7) {
		t.Fatalf("pathValue = %v", got)
	}
	if value := pathValue(withAlias(row, "o", nil), "o"); value != nil {
		t.Fatalf("alias should be replaced, got %v", value)
	}
}

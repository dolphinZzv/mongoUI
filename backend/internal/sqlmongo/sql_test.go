package sqlmongo

import (
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func extJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := bson.MarshalExtJSON(v, false, false)
	if err != nil {
		t.Fatalf("marshal ext json: %v", err)
	}
	return string(raw)
}

func doc(t *testing.T, q *Query) string {
	t.Helper()
	return extJSON(t, q.Filter)
}

func TestSelectStarFrom(t *testing.T) {
	q, err := Translate("SELECT * FROM users")
	if err != nil {
		t.Fatal(err)
	}
	if q.Collection != "users" || q.Aggregate {
		t.Fatalf("unexpected query: %+v", q)
	}
	if got := doc(t, q); got != "{}" {
		t.Fatalf("filter = %s", got)
	}
	if len(q.Projection) != 0 {
		t.Fatalf("projection = %s", extJSON(t, q.Projection))
	}
}

func TestProjectionWhereOrderLimit(t *testing.T) {
	q, err := Translate(`SELECT name, age FROM users
		WHERE age >= 30 AND (status = 'active' OR status = 'trial')
		ORDER BY age DESC LIMIT 10 OFFSET 5`)
	if err != nil {
		t.Fatal(err)
	}
	if q.Aggregate {
		t.Fatalf("expected find query, got aggregate: %+v", q)
	}
	wantFilter := `{"$and":[{"age":{"$gte":30}},{"$or":[{"status":"active"},{"status":"trial"}]}]}`
	if got := doc(t, q); got != wantFilter {
		t.Fatalf("filter =\n  %s\nwant\n  %s", got, wantFilter)
	}
	wantProjection := `{"_id":0,"name":1,"age":1}`
	if got := extJSON(t, q.Projection); got != wantProjection {
		t.Fatalf("projection = %s", got)
	}
	if got := extJSON(t, q.Sort); got != `{"age":-1}` {
		t.Fatalf("sort = %s", got)
	}
	if q.Skip != 5 || q.Limit != 10 {
		t.Fatalf("skip/limit = %d/%d", q.Skip, q.Limit)
	}
}

func TestWhereOperators(t *testing.T) {
	cases := []struct {
		sql  string
		want string
	}{
		{"SELECT * FROM c WHERE a = 1", `{"a":1}`},
		{"SELECT * FROM c WHERE a != 1", `{"a":{"$ne":1}}`},
		{"SELECT * FROM c WHERE a <= 2.5", `{"a":{"$lte":2.5}}`},
		{"SELECT * FROM c WHERE x IN (1, 2, 3)", `{"x":{"$in":[1,2,3]}}`},
		{"SELECT * FROM c WHERE x NOT IN ('a', 'b')", `{"x":{"$nin":["a","b"]}}`},
		{"SELECT * FROM c WHERE name LIKE 'A%'", `{"name":{"$regex":"^A.*$"}}`},
		{"SELECT * FROM c WHERE name NOT LIKE '%x_'", `{"name":{"$not":{"$regex":"^.*x.$"}}}`},
		{"SELECT * FROM c WHERE y IS NULL", `{"y":null}`},
		{"SELECT * FROM c WHERE y IS NOT NULL", `{"y":{"$ne":null}}`},
		{"SELECT * FROM c WHERE NOT (a = 1 OR b = 2)", `{"$nor":[{"$or":[{"a":1},{"b":2}]}]}`},
		{"SELECT * FROM c WHERE a > 1 AND b < 2 AND c = 3", `{"$and":[{"a":{"$gt":1}},{"b":{"$lt":2}},{"c":3}]}`},
	}
	for _, tc := range cases {
		q, err := Translate(tc.sql)
		if err != nil {
			t.Fatalf("%s: %v", tc.sql, err)
		}
		if got := doc(t, q); got != tc.want {
			t.Errorf("%s\n  got  %s\n  want %s", tc.sql, got, tc.want)
		}
	}
}

func TestCountStar(t *testing.T) {
	q, err := Translate("SELECT COUNT(*) AS n FROM users")
	if err != nil {
		t.Fatal(err)
	}
	if !q.Aggregate {
		t.Fatal("expected aggregate")
	}
	want := `{"p":[{"$group":{"_id":null,"n":{"$sum":1}}},{"$project":{"_id":0,"n":"$n"}}]}`
	if got := extJSON(t, bson.D{{Key: "p", Value: q.Pipeline}}); got != want {
		t.Fatalf("pipeline =\n  %s\nwant\n  %s", got, want)
	}
	if len(q.Columns) != 1 || q.Columns[0] != "n" {
		t.Fatalf("columns = %v", q.Columns)
	}
}

func TestGroupByHaving(t *testing.T) {
	q, err := Translate(`SELECT status, COUNT(*) AS n, SUM(amount) AS total
		FROM orders
		WHERE amount > 0
		GROUP BY status
		HAVING COUNT(*) > 5
		ORDER BY total DESC`)
	if err != nil {
		t.Fatal(err)
	}
	if !q.Aggregate {
		t.Fatal("expected aggregate")
	}
	want := `{"p":[` +
		`{"$match":{"amount":{"$gt":0}}},` +
		`{"$group":{"_id":{"k0":"$status"},"n":{"$sum":1},"total":{"$sum":"$amount"}}},` +
		`{"$match":{"n":{"$gt":5}}},` +
		`{"$sort":{"total":-1}},` +
		`{"$project":{"_id":0,"status":"$_id.k0","n":"$n","total":"$total"}}` +
		`]}`
	if got := extJSON(t, bson.D{{Key: "p", Value: q.Pipeline}}); got != want {
		t.Fatalf("pipeline =\n  %s\nwant\n  %s", got, want)
	}
}

func TestDistinct(t *testing.T) {
	q, err := Translate("SELECT DISTINCT status FROM orders")
	if err != nil {
		t.Fatal(err)
	}
	want := `{"p":[{"$group":{"_id":{"k0":"$status"}}},{"$project":{"_id":0,"status":"$_id.k0"}}]}`
	if got := extJSON(t, bson.D{{Key: "p", Value: q.Pipeline}}); got != want {
		t.Fatalf("pipeline =\n  %s\nwant\n  %s", got, want)
	}
	if len(q.Columns) != 1 || q.Columns[0] != "status" {
		t.Fatalf("columns = %v", q.Columns)
	}
}

func TestAliasProjectOnly(t *testing.T) {
	q, err := Translate("SELECT name AS n, age FROM users ORDER BY n")
	if err != nil {
		t.Fatal(err)
	}
	want := `{"p":[{"$project":{"_id":0,"n":"$name","age":"$age"}},{"$sort":{"n":1}}]}`
	if got := extJSON(t, bson.D{{Key: "p", Value: q.Pipeline}}); got != want {
		t.Fatalf("pipeline =\n  %s\nwant\n  %s", got, want)
	}
}

func TestAvgMinMax(t *testing.T) {
	q, err := Translate("SELECT AVG(price) AS avg_price, MIN(price) AS lo, MAX(price) AS hi FROM products")
	if err != nil {
		t.Fatal(err)
	}
	want := `{"p":[{"$group":{"_id":null,"avg_price":{"$avg":"$price"},"lo":{"$min":"$price"},"hi":{"$max":"$price"}}},` +
		`{"$project":{"_id":0,"avg_price":"$avg_price","lo":"$lo","hi":"$hi"}}]}`
	if got := extJSON(t, bson.D{{Key: "p", Value: q.Pipeline}}); got != want {
		t.Fatalf("pipeline =\n  %s\nwant\n  %s", got, want)
	}
}

func TestDottedFieldNames(t *testing.T) {
	q, err := Translate("SELECT address.city FROM users WHERE address.zip = '10001'")
	if err != nil {
		t.Fatal(err)
	}
	if got := extJSON(t, q.Projection); got != `{"_id":0,"address.city":1}` {
		t.Fatalf("projection = %s", got)
	}
	if got := doc(t, q); got != `{"address.zip":"10001"}` {
		t.Fatalf("filter = %s", got)
	}
}

func TestParseErrors(t *testing.T) {
	bad := []string{
		"SELECT",
		"SELECT * users",
		"SELECT * FROM users WHERE",
		"SELECT * FROM users LIMIT x",
		"UPDATE users SET a = 1",
		"SELECT * FROM users WHERE a IN (1,",
	}
	for _, sql := range bad {
		if _, err := Translate(sql); err == nil {
			t.Errorf("expected error for %q", sql)
		}
	}
}

func TestGroupByNonGroupedColumnFails(t *testing.T) {
	if _, err := Translate("SELECT status, name FROM orders GROUP BY status"); err == nil {
		t.Fatal("expected error for non-grouped column")
	}
}

func TestComments(t *testing.T) {
	cases := []struct {
		sql  string
		want string
	}{
		{"-- leading\nSELECT * FROM users /* inline */ WHERE age > 1 -- trailing", `{"age":{"$gt":1}}`},
		{"SELECT * FROM users\n-- comment line\nWHERE name = 'a'", `{"name":"a"}`},
		{"/* block\n comment */ SELECT * FROM users WHERE a = 1", `{"a":1}`},
	}
	for _, tc := range cases {
		q, err := Translate(tc.sql)
		if err != nil {
			t.Fatalf("translate %q: %v", tc.sql, err)
		}
		if got := doc(t, q); got != tc.want {
			t.Errorf("%q: filter = %s, want %s", tc.sql, got, tc.want)
		}
	}
}

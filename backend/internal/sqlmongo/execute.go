package sqlmongo

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	// These caps keep an accidental cross-database join from exhausting memory.
	CrossJoinMaxMainDocs = 20000
	CrossJoinMaxJoinDocs = 50000
	CrossJoinMaxRows     = 100000
)

// ExecuteCrossDB evaluates a simple cross-database equality join in Go. It is
// intentionally limited to SELECT / WHERE / ORDER BY / LIMIT: aggregations and
// grouping would require a full query engine, so Translate rejects them.
func ExecuteCrossDB(ctx context.Context, client *mongo.Client, defaultDB string, query *Query, limit, skip int64) ([]bson.D, int64, error) {
	if query == nil || !query.CrossDB {
		return nil, 0, fmt.Errorf("not a cross-database query")
	}
	mainDB := query.Database
	if mainDB == "" {
		mainDB = defaultDB
	}
	aliases := make([]string, 0, len(query.Joins))
	for _, join := range query.Joins {
		alias := join.Alias
		if alias == "" {
			alias = join.Collection
		}
		aliases = append(aliases, alias)
	}
	mainFilter, _ := splitFilter(query.Filter, aliases)
	rows, err := fetchDocs(ctx, client.Database(mainDB).Collection(query.Collection), mainFilter, CrossJoinMaxMainDocs)
	if err != nil {
		return nil, 0, err
	}
	for _, join := range query.Joins {
		rows, err = applyJoin(ctx, client, mainDB, rows, join)
		if err != nil {
			return nil, 0, err
		}
	}

	filtered := make([]bson.D, 0, len(rows))
	for _, row := range rows {
		if matchFilter(row, query.Filter) {
			filtered = append(filtered, row)
		}
	}
	total := int64(len(filtered))

	projected := make([]bson.D, 0, len(filtered))
	for _, row := range filtered {
		projected = append(projected, projectRow(row, query.Select))
	}
	if len(query.OrderBy) > 0 {
		sortRows(projected, query.OrderBy, query.Select)
	}
	if skip < 0 {
		skip = 0
	}
	if skip >= int64(len(projected)) {
		return []bson.D{}, total, nil
	}
	projected = projected[skip:]
	if limit > 0 && int64(len(projected)) > limit {
		projected = projected[:limit]
	}
	return projected, total, nil
}

// splitFilter pushes predicates that only reference the main document into the
// initial Find, while keeping joined-field predicates for the post-join pass.
func splitFilter(filter bson.D, joinAliases []string) (bson.D, bson.D) {
	main := bson.D{}
	rest := bson.D{}
	for _, e := range filter {
		switch e.Key {
		case "$and":
			parts := asDocs(e.Value)
			var mainParts []bson.D
			var restParts []bson.D
			for _, part := range parts {
				m, r := splitFilter(part, joinAliases)
				if len(m) > 0 {
					mainParts = append(mainParts, m)
				}
				if len(r) > 0 {
					restParts = append(restParts, r)
				}
			}
			if len(mainParts) > 0 {
				main = append(main, bson.E{Key: "$and", Value: mainParts})
			}
			if len(restParts) > 0 {
				rest = append(rest, bson.E{Key: "$and", Value: restParts})
			}
		case "$or", "$nor":
			parts := asDocs(e.Value)
			allMain := len(parts) > 0
			for _, part := range parts {
				_, r := splitFilter(part, joinAliases)
				if len(r) > 0 {
					allMain = false
					break
				}
			}
			if allMain {
				main = append(main, e)
			} else {
				rest = append(rest, e)
			}
		case "$expr":
			if exprMainOnly(e.Value, joinAliases) {
				main = append(main, e)
			} else {
				rest = append(rest, e)
			}
		default:
			if fieldMainOnly(e.Key, joinAliases) {
				main = append(main, e)
			} else {
				rest = append(rest, e)
			}
		}
	}
	return main, rest
}

func fieldMainOnly(field string, joinAliases []string) bool {
	for _, alias := range joinAliases {
		if strings.HasPrefix(field, alias+".") {
			return false
		}
	}
	return true
}

func exprMainOnly(expression any, joinAliases []string) bool {
	switch value := expression.(type) {
	case string:
		if strings.HasPrefix(value, "$") && !strings.HasPrefix(value, "$$") {
			return fieldMainOnly(strings.TrimPrefix(value, "$"), joinAliases)
		}
	case bson.A:
		for _, item := range value {
			if !exprMainOnly(item, joinAliases) {
				return false
			}
		}
	case []any:
		for _, item := range value {
			if !exprMainOnly(item, joinAliases) {
				return false
			}
		}
	case bson.D:
		for _, item := range value {
			if !exprMainOnly(item.Value, joinAliases) {
				return false
			}
		}
	case bson.M:
		for _, item := range value {
			if !exprMainOnly(item, joinAliases) {
				return false
			}
		}
	}
	return true
}

func fetchDocs(ctx context.Context, coll *mongo.Collection, filter bson.D, cap int) ([]bson.D, error) {
	cursor, err := coll.Find(ctx, filter, options.Find().SetLimit(int64(cap)+1))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	docs := []bson.D{}
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}
	if len(docs) > cap {
		return nil, fmt.Errorf("cross-database join matched more than %d documents; add a narrower filter", cap)
	}
	return docs, nil
}

func applyJoin(ctx context.Context, client *mongo.Client, mainDB string, rows []bson.D, join Join) ([]bson.D, error) {
	alias := join.Alias
	if alias == "" {
		alias = join.Collection
	}
	if strings.Contains(alias, ".") {
		return nil, fmt.Errorf("JOIN on collection %q needs an alias", join.Collection)
	}
	left, err := asColumn(join.Left)
	if err != nil {
		return nil, fmt.Errorf("JOIN ON left side: %w", err)
	}
	right, err := asColumn(join.Right)
	if err != nil {
		return nil, fmt.Errorf("JOIN ON right side: %w", err)
	}
	local, foreign := left, right
	leftIsJoin := strings.HasPrefix(left, alias+".")
	rightIsJoin := strings.HasPrefix(right, alias+".")
	switch {
	case leftIsJoin && !rightIsJoin:
		local, foreign = right, strings.TrimPrefix(left, alias+".")
	case rightIsJoin && !leftIsJoin:
		foreign = strings.TrimPrefix(right, alias+".")
	case leftIsJoin && rightIsJoin:
		return nil, fmt.Errorf("JOIN ON must reference both tables")
	default:
		foreign = right
	}

	joinDB := mainDB
	joinCollection := join.Collection
	if dot := strings.Index(joinCollection, "."); dot > 0 && dot < len(joinCollection)-1 {
		joinDB = joinCollection[:dot]
		joinCollection = joinCollection[dot+1:]
	}

	seen := map[string]bool{}
	values := make([]any, 0, len(rows))
	for _, row := range rows {
		value := pathValue(row, local)
		if value == nil {
			continue
		}
		key := valueKey(value)
		if seen[key] {
			continue
		}
		seen[key] = true
		values = append(values, value)
	}

	joined := []bson.D{}
	if len(values) > 0 {
		filter := bson.D{{Key: foreign, Value: bson.D{{Key: "$in", Value: values}}}}
		joined, err = fetchDocs(ctx, client.Database(joinDB).Collection(joinCollection), filter, CrossJoinMaxJoinDocs)
		if err != nil {
			return nil, err
		}
	}
	byKey := map[string][]bson.D{}
	for _, doc := range joined {
		key := valueKey(pathValue(doc, foreign))
		byKey[key] = append(byKey[key], doc)
	}

	out := make([]bson.D, 0, len(rows))
	for _, row := range rows {
		matches := byKey[valueKey(pathValue(row, local))]
		if len(matches) == 0 {
			if join.LeftJoin {
				out = append(out, withAlias(row, alias, nil))
			}
			continue
		}
		for _, match := range matches {
			out = append(out, withAlias(row, alias, match))
			if len(out) > CrossJoinMaxRows {
				return nil, fmt.Errorf("cross-database join produced more than %d rows", CrossJoinMaxRows)
			}
		}
	}
	return out, nil
}

func withAlias(row bson.D, alias string, value any) bson.D {
	out := make(bson.D, len(row), len(row)+1)
	copy(out, row)
	for i := range out {
		if out[i].Key == alias {
			out[i].Value = value
			return out
		}
	}
	return append(out, bson.E{Key: alias, Value: value})
}

func valueKey(value any) string {
	if value == nil {
		return ""
	}
	if _, raw, err := bson.MarshalValue(value); err == nil {
		return string(raw)
	}
	return fmt.Sprintf("%T:%v", value, value)
}

// pathValue resolves a dotted field path in a BSON document.
func pathValue(doc bson.D, path string) any {
	if path == "" {
		return nil
	}
	var current any = doc
	for _, part := range strings.Split(path, ".") {
		switch value := current.(type) {
		case bson.D:
			current = nil
			for _, e := range value {
				if e.Key == part {
					current = e.Value
					break
				}
			}
		case bson.M:
			current = value[part]
		case map[string]any:
			current = value[part]
		default:
			return nil
		}
		if current == nil {
			return nil
		}
	}
	return current
}

func projectRow(row bson.D, selectItems []SelectItem) bson.D {
	if len(selectItems) == 1 && selectItems[0].Star {
		return row
	}
	out := make(bson.D, 0, len(selectItems))
	for _, item := range selectItems {
		column, err := asColumn(item.Expr)
		if err != nil {
			continue
		}
		name := item.Alias
		if name == "" {
			name = strings.ReplaceAll(column, ".", "_")
		}
		out = append(out, bson.E{Key: name, Value: pathValue(row, column)})
	}
	return out
}

func sortRows(rows []bson.D, order []OrderItem, selectItems []SelectItem) {
	names := map[string]string{}
	for _, item := range selectItems {
		if column, err := asColumn(item.Expr); err == nil {
			out := item.Alias
			if out == "" {
				out = strings.ReplaceAll(column, ".", "_")
			}
			names[column], names[out] = out, out
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		for _, item := range order {
			column, err := asColumn(item.Expr)
			if err != nil {
				continue
			}
			key := names[column]
			if key == "" {
				key = column
			}
			cmp := compareValues(pathValue(rows[i], key), pathValue(rows[j], key))
			if cmp != 0 {
				if item.Desc {
					return cmp > 0
				}
				return cmp < 0
			}
		}
		return false
	})
}

func matchFilter(doc bson.D, filter bson.D) bool {
	for _, e := range filter {
		switch e.Key {
		case "$and":
			for _, part := range asDocs(e.Value) {
				if !matchFilter(doc, part) {
					return false
				}
			}
		case "$or":
			any := false
			for _, part := range asDocs(e.Value) {
				if matchFilter(doc, part) {
					any = true
					break
				}
			}
			if !any {
				return false
			}
		case "$nor":
			for _, part := range asDocs(e.Value) {
				if matchFilter(doc, part) {
					return false
				}
			}
		case "$expr":
			if !evalExpr(doc, e.Value) {
				return false
			}
		default:
			if !matchValue(pathValue(doc, e.Key), e.Value) {
				return false
			}
		}
	}
	return true
}

func asDocs(value any) []bson.D {
	switch v := value.(type) {
	case bson.A:
		out := make([]bson.D, 0, len(v))
		for _, item := range v {
			if doc, ok := item.(bson.D); ok {
				out = append(out, doc)
			}
		}
		return out
	case []bson.D:
		return v
	case bson.D:
		return []bson.D{v}
	default:
		return nil
	}
}

func matchValue(actual, condition any) bool {
	if doc, ok := condition.(bson.D); ok {
		operator := false
		for _, e := range doc {
			if strings.HasPrefix(e.Key, "$") {
				operator = true
				break
			}
		}
		if operator {
			for _, e := range doc {
				if !matchOperator(actual, e.Key, e.Value) {
					return false
				}
			}
			return true
		}
	}
	return equalValues(actual, condition)
}

func matchOperator(actual any, op string, expected any) bool {
	switch op {
	case "$eq":
		return equalValues(actual, expected)
	case "$ne":
		return !equalValues(actual, expected)
	case "$gt":
		return compareValues(actual, expected) > 0
	case "$gte":
		return compareValues(actual, expected) >= 0
	case "$lt":
		return compareValues(actual, expected) < 0
	case "$lte":
		return compareValues(actual, expected) <= 0
	case "$in", "$nin":
		found := false
		for _, item := range asValues(expected) {
			if equalValues(actual, item) {
				found = true
				break
			}
		}
		if op == "$nin" {
			return !found
		}
		return found
	case "$not":
		return !matchValue(actual, expected)
	case "$regex":
		pattern := fmt.Sprint(expected)
		matched, err := regexp.MatchString(pattern, fmt.Sprint(actual))
		return err == nil && matched
	case "$exists":
		want, _ := expected.(bool)
		return (actual != nil) == want
	default:
		return false
	}
}

func asValues(value any) []any {
	switch v := value.(type) {
	case bson.A:
		return v
	case []any:
		return v
	default:
		return []any{v}
	}
}

func evalExpr(doc bson.D, expression any) bool {
	expr, ok := expression.(bson.D)
	if !ok || len(expr) != 1 {
		return false
	}
	op := expr[0].Key
	args := asValues(expr[0].Value)
	if op == "$and" || op == "$or" {
		result := op == "$and"
		for _, arg := range args {
			value := evalExpr(doc, arg)
			if op == "$and" && !value {
				return false
			}
			if op == "$or" && value {
				return true
			}
		}
		return result
	}
	if len(args) != 2 {
		return false
	}
	left := evalValue(doc, args[0])
	right := evalValue(doc, args[1])
	switch op {
	case "$eq":
		return equalValues(left, right)
	case "$ne":
		return !equalValues(left, right)
	case "$gt":
		return compareValues(left, right) > 0
	case "$gte":
		return compareValues(left, right) >= 0
	case "$lt":
		return compareValues(left, right) < 0
	case "$lte":
		return compareValues(left, right) <= 0
	default:
		return false
	}
}

func evalValue(doc bson.D, value any) any {
	if ref, ok := value.(string); ok && strings.HasPrefix(ref, "$") {
		return pathValue(doc, strings.TrimPrefix(ref, "$"))
	}
	return value
}

func equalValues(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	if na, ok := numberValue(a); ok {
		if nb, ok := numberValue(b); ok {
			return na == nb
		}
		return false
	}
	switch av := a.(type) {
	case string:
		bv, ok := b.(string)
		return ok && av == bv
	case bool:
		bv, ok := b.(bool)
		return ok && av == bv
	case primitive.ObjectID:
		bv, ok := b.(primitive.ObjectID)
		return ok && av == bv
	case time.Time:
		bv, ok := b.(time.Time)
		return ok && av.Equal(bv)
	case primitive.DateTime:
		bv, ok := b.(primitive.DateTime)
		return ok && av == bv
	}
	return fmt.Sprintf("%T:%v", a, a) == fmt.Sprintf("%T:%v", b, b)
}

func compareValues(a, b any) int {
	if a == nil {
		if b == nil {
			return 0
		}
		return -1
	}
	if b == nil {
		return 1
	}
	if na, ok := numberValue(a); ok {
		if nb, ok := numberValue(b); ok {
			switch {
			case na < nb:
				return -1
			case na > nb:
				return 1
			default:
				return 0
			}
		}
	}
	if ta, ok := a.(time.Time); ok {
		if tb, ok := b.(time.Time); ok {
			return ta.Compare(tb)
		}
	}
	if oa, ok := a.(primitive.ObjectID); ok {
		if ob, ok := b.(primitive.ObjectID); ok {
			return strings.Compare(oa.Hex(), ob.Hex())
		}
	}
	return strings.Compare(fmt.Sprint(a), fmt.Sprint(b))
}

func numberValue(value any) (float64, bool) {
	switch v := value.(type) {
	case int:
		return float64(v), true
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case float32:
		return float64(v), true
	case float64:
		return v, true
	case primitive.Decimal128:
		out, err := strconv.ParseFloat(v.String(), 64)
		return out, err == nil
	}
	return 0, false
}

package sqlmongo

import (
	"fmt"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
)

// Query is the translated MongoDB query.
//
// When Aggregate is false, Filter/Projection/Sort describe a find query.
// When Aggregate is true, Pipeline is a complete aggregation pipeline up to
// (but excluding) $skip/$limit, which the caller appends after enforcing its
// own result limits.
type Query struct {
	Collection string
	Aggregate  bool
	Filter     bson.D
	Projection bson.D
	Sort       bson.D
	Skip       int64
	Limit      int64
	Pipeline   []bson.D
	Columns    []string
}

// Translate parses and translates a SQL SELECT statement.
func Translate(input string) (*Query, error) {
	st, err := Parse(input)
	if err != nil {
		return nil, err
	}

	filter, err := buildFilter(st.Where)
	if err != nil {
		return nil, err
	}

	q := &Query{
		Collection: st.Collection,
		Filter:     filter,
		Skip:       st.Offset,
		Limit:      st.Limit,
	}

	useAggregate := st.Distinct || len(st.GroupBy) > 0 || hasAggregate(st) || hasAlias(st)
	if useAggregate {
		q.Aggregate = true
		pipeline, columns, err := buildAggregation(st, filter)
		if err != nil {
			return nil, err
		}
		q.Pipeline = pipeline
		q.Columns = columns
		return q, nil
	}

	projection, columns, err := buildProjection(st.Select)
	if err != nil {
		return nil, err
	}
	q.Projection = projection
	q.Columns = columns
	if q.Sort, err = buildSort(st.OrderBy); err != nil {
		return nil, err
	}
	return q, nil
}

// --- WHERE -> filter --------------------------------------------------------

var comparisonOps = map[string]string{
	"=":  "$eq",
	"!=": "$ne",
	"<>": "$ne",
	">":  "$gt",
	">=": "$gte",
	"<":  "$lt",
	"<=": "$lte",
}

func buildFilter(e Expr) (bson.D, error) {
	if e == nil {
		return bson.D{}, nil
	}
	switch v := e.(type) {
	case *LogicalExpr:
		left, err := buildFilter(v.Left)
		if err != nil {
			return nil, err
		}
		right, err := buildFilter(v.Right)
		if err != nil {
			return nil, err
		}
		if v.Op == "OR" {
			return mergeLogical("$or", left, right), nil
		}
		return mergeLogical("$and", left, right), nil
	case *NotExpr:
		inner, err := buildFilter(v.Expr)
		if err != nil {
			return nil, err
		}
		return bson.D{{Key: "$nor", Value: bson.A{inner}}}, nil
	case *BinaryExpr:
		return buildComparison(v)
	case *InExpr:
		col, err := asColumn(v.Expr)
		if err != nil {
			return nil, err
		}
		values := make(bson.A, 0, len(v.Values))
		for _, value := range v.Values {
			literal, err := literalValue(value)
			if err != nil {
				return nil, err
			}
			values = append(values, literal)
		}
		op := "$in"
		if v.Not {
			op = "$nin"
		}
		return bson.D{{Key: col, Value: bson.D{{Key: op, Value: values}}}}, nil
	case *LikeExpr:
		col, err := asColumn(v.Expr)
		if err != nil {
			return nil, err
		}
		regex := likeToRegex(v.Pattern)
		if v.Not {
			return bson.D{{Key: col, Value: bson.D{{Key: "$not", Value: bson.D{{Key: "$regex", Value: regex}}}}}}, nil
		}
		return bson.D{{Key: col, Value: bson.D{{Key: "$regex", Value: regex}}}}, nil
	case *IsNullExpr:
		col, err := asColumn(v.Expr)
		if err != nil {
			return nil, err
		}
		if v.Not {
			return bson.D{{Key: col, Value: bson.D{{Key: "$ne", Value: nil}}}}, nil
		}
		return bson.D{{Key: col, Value: nil}}, nil
	}
	return nil, fmt.Errorf("unsupported WHERE expression")
}

func buildComparison(v *BinaryExpr) (bson.D, error) {
	op, ok := comparisonOps[v.Op]
	if !ok {
		return nil, fmt.Errorf("unsupported operator %q", v.Op)
	}
	if col, err := asColumn(v.Left); err == nil {
		if literal, err := literalValue(v.Right); err == nil {
			if op == "$eq" {
				return bson.D{{Key: col, Value: literal}}, nil
			}
			return bson.D{{Key: col, Value: bson.D{{Key: op, Value: literal}}}}, nil
		}
	}
	// Field-to-field comparison (or non-literal operands): use $expr.
	left, err := exprFieldValue(v.Left)
	if err != nil {
		return nil, err
	}
	right, err := exprFieldValue(v.Right)
	if err != nil {
		return nil, err
	}
	return bson.D{{Key: "$expr", Value: bson.D{{Key: op, Value: bson.A{left, right}}}}}, nil
}

func mergeLogical(op string, docs ...bson.D) bson.D {
	parts := bson.A{}
	for _, doc := range docs {
		if len(doc) == 1 && doc[0].Key == op {
			if arr, ok := doc[0].Value.(bson.A); ok {
				parts = append(parts, arr...)
				continue
			}
		}
		parts = append(parts, doc)
	}
	return bson.D{{Key: op, Value: parts}}
}

// likeToRegex converts a SQL LIKE pattern to an anchored regex string.
func likeToRegex(pattern string) string {
	var sb strings.Builder
	sb.WriteString("^")
	for i := 0; i < len(pattern); i++ {
		c := pattern[i]
		switch c {
		case '%':
			sb.WriteString(".*")
		case '_':
			sb.WriteString(".")
		case '\\':
			if i+1 < len(pattern) {
				i++
				sb.WriteString(quoteRegexByte(pattern[i]))
			}
		default:
			sb.WriteString(quoteRegexByte(c))
		}
	}
	sb.WriteString("$")
	return sb.String()
}

func quoteRegexByte(c byte) string {
	switch c {
	case '.', '+', '*', '?', '(', ')', '|', '[', ']', '{', '}', '^', '$', '\\':
		return "\\" + string(c)
	default:
		return string(c)
	}
}

// --- find projection / sort -------------------------------------------------

func buildProjection(items []SelectItem) (bson.D, []string, error) {
	if len(items) == 1 && items[0].Star {
		return nil, nil, nil
	}
	projection := bson.D{}
	columns := make([]string, 0, len(items))
	includeID := false
	for _, item := range items {
		if item.Star {
			return nil, nil, fmt.Errorf("cannot mix * with other columns")
		}
		col, err := asColumn(item.Expr)
		if err != nil {
			return nil, nil, err
		}
		projection = append(projection, bson.E{Key: col, Value: 1})
		columns = append(columns, col)
		if col == "_id" {
			includeID = true
		}
	}
	if !includeID {
		projection = append(bson.D{{Key: "_id", Value: 0}}, projection...)
	}
	return projection, columns, nil
}

func buildSort(items []OrderItem) (bson.D, error) {
	var sort bson.D
	for _, item := range items {
		col, err := asColumn(item.Expr)
		if err != nil {
			return nil, err
		}
		dir := 1
		if item.Desc {
			dir = -1
		}
		sort = append(sort, bson.E{Key: col, Value: dir})
	}
	return sort, nil
}

func buildOutputSort(items []OrderItem, names map[string]string) (bson.D, error) {
	var sort bson.D
	for _, item := range items {
		col, err := asColumn(item.Expr)
		if err != nil {
			return nil, err
		}
		name := names[col]
		if name == "" {
			name = col
		}
		dir := 1
		if item.Desc {
			dir = -1
		}
		sort = append(sort, bson.E{Key: name, Value: dir})
	}
	return sort, nil
}

// --- aggregation ------------------------------------------------------------

func buildAggregation(st *Statement, filter bson.D) ([]bson.D, []string, error) {
	switch {
	case st.Distinct && !hasAggregate(st) && len(st.GroupBy) == 0:
		return buildDistinct(st, filter)
	case !hasAggregate(st) && len(st.GroupBy) == 0:
		return buildProjectOnly(st, filter)
	default:
		return buildGrouped(st, filter)
	}
}

// buildProjectOnly handles SELECT a AS x, b FROM c (aliases without grouping).
func buildProjectOnly(st *Statement, filter bson.D) ([]bson.D, []string, error) {
	projection := bson.D{}
	columns := []string{}
	names := map[string]string{}
	includeID := false
	for _, item := range st.Select {
		if item.Star {
			return nil, nil, fmt.Errorf("SELECT * cannot be combined with aliases")
		}
		col, err := asColumn(item.Expr)
		if err != nil {
			return nil, nil, err
		}
		out := item.Alias
		if out == "" {
			out = col
		}
		projection = append(projection, bson.E{Key: out, Value: "$" + col})
		columns = append(columns, out)
		names[col], names[out] = out, out
		if out == "_id" {
			includeID = true
		}
	}
	if !includeID {
		projection = append(bson.D{{Key: "_id", Value: 0}}, projection...)
	}

	var pipeline []bson.D
	if len(filter) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: filter}})
	}
	pipeline = append(pipeline, bson.D{{Key: "$project", Value: projection}})
	sort, err := buildOutputSort(st.OrderBy, names)
	if err != nil {
		return nil, nil, err
	}
	if len(sort) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$sort", Value: sort}})
	}
	return pipeline, columns, nil
}

// buildDistinct handles SELECT DISTINCT a, b FROM c.
func buildDistinct(st *Statement, filter bson.D) ([]bson.D, []string, error) {
	keys := bson.D{}
	projection := bson.D{}
	columns := []string{}
	names := map[string]string{}
	for i, item := range st.Select {
		if item.Star {
			return nil, nil, fmt.Errorf("SELECT DISTINCT * is not supported; list the columns")
		}
		col, err := asColumn(item.Expr)
		if err != nil {
			return nil, nil, err
		}
		out := item.Alias
		if out == "" {
			out = col
		}
		key := fmt.Sprintf("k%d", i)
		keys = append(keys, bson.E{Key: key, Value: "$" + col})
		projection = append(projection, bson.E{Key: out, Value: "$_id." + key})
		columns = append(columns, out)
		names[col], names[out] = out, out
	}
	if len(keys) == 0 {
		return nil, nil, fmt.Errorf("SELECT DISTINCT needs at least one column")
	}
	projection = append(bson.D{{Key: "_id", Value: 0}}, projection...)

	var pipeline []bson.D
	if len(filter) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: filter}})
	}
	pipeline = append(pipeline, bson.D{{Key: "$group", Value: bson.D{{Key: "_id", Value: keys}}}})
	pipeline = append(pipeline, bson.D{{Key: "$project", Value: projection}})
	sort, err := buildOutputSort(st.OrderBy, names)
	if err != nil {
		return nil, nil, err
	}
	if len(sort) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$sort", Value: sort}})
	}
	return pipeline, columns, nil
}

type accumulator struct {
	field     string
	canonical string
	doc       bson.D
}

// buildGrouped handles GROUP BY and aggregate functions.
func buildGrouped(st *Statement, filter bson.D) ([]bson.D, []string, error) {
	groupKeys := bson.D{}
	groupKeyByExpr := map[string]string{}
	fieldByColumn := map[string]string{}
	for i, ge := range st.GroupBy {
		value, err := exprFieldValue(ge)
		if err != nil {
			return nil, nil, err
		}
		key := fmt.Sprintf("k%d", i)
		groupKeys = append(groupKeys, bson.E{Key: key, Value: value})
		groupKeyByExpr[canonical(ge)] = key
		if col, err := asColumn(ge); err == nil {
			fieldByColumn[col] = "_id." + key
		}
	}

	byCanonical := map[string]*accumulator{}
	aliasToField := map[string]string{}
	var accs []*accumulator
	used := map[string]bool{}
	uniqueField := func(base string) string {
		if base == "" {
			base = "agg"
		}
		name, i := base, 2
		for used[name] {
			name = fmt.Sprintf("%s_%d", base, i)
			i++
		}
		used[name] = true
		return name
	}
	addAcc := func(fc *FuncCall, alias string) error {
		key := canonical(fc)
		if a, ok := byCanonical[key]; ok {
			if alias != "" {
				aliasToField[alias] = a.field
			}
			return nil
		}
		name := alias
		if name == "" {
			name = autoField(fc)
		}
		name = uniqueField(name)
		doc, err := accumulatorDoc(fc)
		if err != nil {
			return err
		}
		a := &accumulator{field: name, canonical: key, doc: doc}
		byCanonical[key] = a
		accs = append(accs, a)
		if alias != "" {
			aliasToField[alias] = name
		}
		return nil
	}

	for _, item := range st.Select {
		if item.Star {
			return nil, nil, fmt.Errorf("SELECT * cannot be combined with GROUP BY or aggregates")
		}
		if fc, ok := item.Expr.(*FuncCall); ok && isAggregateName(fc.Name) {
			if err := addAcc(fc, item.Alias); err != nil {
				return nil, nil, err
			}
		}
	}
	var collect func(e Expr) error
	collect = func(e Expr) error {
		switch v := e.(type) {
		case nil:
		case *FuncCall:
			if isAggregateName(v.Name) {
				return addAcc(v, "")
			}
		case *LogicalExpr:
			if err := collect(v.Left); err != nil {
				return err
			}
			return collect(v.Right)
		case *NotExpr:
			return collect(v.Expr)
		case *BinaryExpr:
			if err := collect(v.Left); err != nil {
				return err
			}
			return collect(v.Right)
		case *InExpr:
			return collect(v.Expr)
		case *LikeExpr:
			return collect(v.Expr)
		case *IsNullExpr:
			return collect(v.Expr)
		}
		return nil
	}
	if err := collect(st.Having); err != nil {
		return nil, nil, err
	}
	for _, item := range st.OrderBy {
		if err := collect(item.Expr); err != nil {
			return nil, nil, err
		}
	}

	resolve := func(e Expr) (string, error) {
		switch v := e.(type) {
		case *FuncCall:
			if isAggregateName(v.Name) {
				if a, ok := byCanonical[canonical(v)]; ok {
					return a.field, nil
				}
				return "", fmt.Errorf("%s is not used in this query", canonical(v))
			}
			return "", fmt.Errorf("unsupported function %s", v.Name)
		case *ColumnRef:
			if field, ok := aliasToField[v.Name]; ok {
				return field, nil
			}
			if field, ok := fieldByColumn[v.Name]; ok {
				return field, nil
			}
			if key, ok := groupKeyByExpr[v.Name]; ok {
				return "_id." + key, nil
			}
			return "", fmt.Errorf("field %q must appear in GROUP BY or an aggregate", v.Name)
		default:
			return "", fmt.Errorf("unsupported expression in HAVING / ORDER BY")
		}
	}

	group := bson.D{{Key: "_id", Value: any(nil)}}
	if len(groupKeys) > 0 {
		group[0].Value = groupKeys
	}
	for _, a := range accs {
		group = append(group, bson.E{Key: a.field, Value: a.doc})
	}

	projection := bson.D{{Key: "_id", Value: 0}}
	columns := []string{}
	for _, item := range st.Select {
		if fc, ok := item.Expr.(*FuncCall); ok && isAggregateName(fc.Name) {
			a := byCanonical[canonical(fc)]
			out := item.Alias
			if out == "" {
				out = a.field
			}
			projection = append(projection, bson.E{Key: out, Value: "$" + a.field})
			columns = append(columns, out)
			continue
		}
		col, err := asColumn(item.Expr)
		if err != nil {
			return nil, nil, err
		}
		field, err := resolve(item.Expr)
		if err != nil {
			return nil, nil, err
		}
		out := item.Alias
		if out == "" {
			out = col
		}
		projection = append(projection, bson.E{Key: out, Value: "$" + field})
		columns = append(columns, out)
	}

	var pipeline []bson.D
	if len(filter) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: filter}})
	}
	pipeline = append(pipeline, bson.D{{Key: "$group", Value: group}})

	if having, err := buildHaving(st.Having, resolve); err != nil {
		return nil, nil, err
	} else if len(having) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: having}})
	}

	if len(st.OrderBy) > 0 {
		sort := bson.D{}
		for _, item := range st.OrderBy {
			field, err := resolve(item.Expr)
			if err != nil {
				return nil, nil, err
			}
			dir := 1
			if item.Desc {
				dir = -1
			}
			sort = append(sort, bson.E{Key: field, Value: dir})
		}
		pipeline = append(pipeline, bson.D{{Key: "$sort", Value: sort}})
	}

	pipeline = append(pipeline, bson.D{{Key: "$project", Value: projection}})
	return pipeline, columns, nil
}

func buildHaving(e Expr, resolve func(Expr) (string, error)) (bson.D, error) {
	if e == nil {
		return bson.D{}, nil
	}
	switch v := e.(type) {
	case *LogicalExpr:
		left, err := buildHaving(v.Left, resolve)
		if err != nil {
			return nil, err
		}
		right, err := buildHaving(v.Right, resolve)
		if err != nil {
			return nil, err
		}
		if v.Op == "OR" {
			return mergeLogical("$or", left, right), nil
		}
		return mergeLogical("$and", left, right), nil
	case *NotExpr:
		inner, err := buildHaving(v.Expr, resolve)
		if err != nil {
			return nil, err
		}
		return bson.D{{Key: "$nor", Value: bson.A{inner}}}, nil
	case *BinaryExpr:
		op, ok := comparisonOps[v.Op]
		if !ok {
			return nil, fmt.Errorf("unsupported operator %q in HAVING", v.Op)
		}
		field, err := resolve(v.Left)
		if err != nil {
			return nil, err
		}
		literal, err := literalValue(v.Right)
		if err != nil {
			return nil, err
		}
		if op == "$eq" {
			return bson.D{{Key: field, Value: literal}}, nil
		}
		return bson.D{{Key: field, Value: bson.D{{Key: op, Value: literal}}}}, nil
	case *InExpr:
		field, err := resolve(v.Expr)
		if err != nil {
			return nil, err
		}
		values := make(bson.A, 0, len(v.Values))
		for _, value := range v.Values {
			literal, err := literalValue(value)
			if err != nil {
				return nil, err
			}
			values = append(values, literal)
		}
		op := "$in"
		if v.Not {
			op = "$nin"
		}
		return bson.D{{Key: field, Value: bson.D{{Key: op, Value: values}}}}, nil
	case *LikeExpr:
		field, err := resolve(v.Expr)
		if err != nil {
			return nil, err
		}
		regex := likeToRegex(v.Pattern)
		if v.Not {
			return bson.D{{Key: field, Value: bson.D{{Key: "$not", Value: bson.D{{Key: "$regex", Value: regex}}}}}}, nil
		}
		return bson.D{{Key: field, Value: bson.D{{Key: "$regex", Value: regex}}}}, nil
	case *IsNullExpr:
		field, err := resolve(v.Expr)
		if err != nil {
			return nil, err
		}
		if v.Not {
			return bson.D{{Key: field, Value: bson.D{{Key: "$ne", Value: nil}}}}, nil
		}
		return bson.D{{Key: field, Value: nil}}, nil
	}
	return nil, fmt.Errorf("unsupported HAVING expression")
}

// --- helpers ----------------------------------------------------------------

func asColumn(e Expr) (string, error) {
	if c, ok := e.(*ColumnRef); ok {
		return c.Name, nil
	}
	return "", fmt.Errorf("expected a field name")
}

func literalValue(e Expr) (any, error) {
	if l, ok := e.(*Literal); ok {
		return l.Value, nil
	}
	return nil, fmt.Errorf("expected a literal value")
}

// exprFieldValue converts an expression to a MongoDB field/value reference.
func exprFieldValue(e Expr) (any, error) {
	switch v := e.(type) {
	case *ColumnRef:
		return "$" + v.Name, nil
	case *Literal:
		return v.Value, nil
	}
	return nil, fmt.Errorf("expected a field name or literal")
}

func isAggregateName(name string) bool {
	switch strings.ToUpper(name) {
	case "COUNT", "SUM", "AVG", "MIN", "MAX":
		return true
	}
	return false
}

func autoField(fc *FuncCall) string {
	base := strings.ToLower(fc.Name)
	if len(fc.Args) == 1 {
		if col, err := asColumn(fc.Args[0]); err == nil {
			return base + "_" + strings.ReplaceAll(col, ".", "_")
		}
	}
	return base
}

func accumulatorDoc(fc *FuncCall) (bson.D, error) {
	name := strings.ToUpper(fc.Name)
	if len(fc.Args) == 0 {
		return nil, fmt.Errorf("%s expects at least one argument", name)
	}
	if name == "COUNT" {
		if _, ok := fc.Args[0].(*StarExpr); ok {
			return bson.D{{Key: "$sum", Value: 1}}, nil
		}
	}
	if len(fc.Args) != 1 {
		return nil, fmt.Errorf("%s expects exactly one argument", name)
	}
	value, err := exprFieldValue(fc.Args[0])
	if err != nil {
		return nil, err
	}
	switch name {
	case "COUNT":
		// Count non-null values.
		return bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{
			bson.D{{Key: "$ne", Value: bson.A{value, nil}}}, 1, 0,
		}}}}}, nil
	case "SUM":
		return bson.D{{Key: "$sum", Value: value}}, nil
	case "AVG":
		return bson.D{{Key: "$avg", Value: value}}, nil
	case "MIN":
		return bson.D{{Key: "$min", Value: value}}, nil
	case "MAX":
		return bson.D{{Key: "$max", Value: value}}, nil
	}
	return nil, fmt.Errorf("unsupported aggregate %s", name)
}

func hasAlias(st *Statement) bool {
	for _, item := range st.Select {
		if item.Star {
			continue
		}
		if item.Alias == "" {
			continue
		}
		if col, err := asColumn(item.Expr); err == nil && col == item.Alias {
			continue
		}
		return true
	}
	return false
}

func hasAggregate(st *Statement) bool {
	for _, item := range st.Select {
		if fc, ok := item.Expr.(*FuncCall); ok && isAggregateName(fc.Name) {
			return true
		}
	}
	if exprHasAggregate(st.Having) {
		return true
	}
	for _, item := range st.OrderBy {
		if exprHasAggregate(item.Expr) {
			return true
		}
	}
	return false
}

func exprHasAggregate(e Expr) bool {
	switch v := e.(type) {
	case nil:
		return false
	case *FuncCall:
		return isAggregateName(v.Name)
	case *LogicalExpr:
		return exprHasAggregate(v.Left) || exprHasAggregate(v.Right)
	case *NotExpr:
		return exprHasAggregate(v.Expr)
	case *BinaryExpr:
		return exprHasAggregate(v.Left) || exprHasAggregate(v.Right)
	case *InExpr:
		return exprHasAggregate(v.Expr)
	case *LikeExpr:
		return exprHasAggregate(v.Expr)
	case *IsNullExpr:
		return exprHasAggregate(v.Expr)
	}
	return false
}

func canonical(e Expr) string {
	switch v := e.(type) {
	case *Literal:
		return fmt.Sprintf("%#v", v.Value)
	case *ColumnRef:
		return v.Name
	case *StarExpr:
		return "*"
	case *FuncCall:
		parts := make([]string, len(v.Args))
		for i, a := range v.Args {
			parts[i] = canonical(a)
		}
		return v.Name + "(" + strings.Join(parts, ",") + ")"
	case *BinaryExpr:
		return canonical(v.Left) + " " + v.Op + " " + canonical(v.Right)
	case *LogicalExpr:
		return canonical(v.Left) + " " + v.Op + " " + canonical(v.Right)
	case *NotExpr:
		return "NOT " + canonical(v.Expr)
	}
	return fmt.Sprintf("%T", e)
}

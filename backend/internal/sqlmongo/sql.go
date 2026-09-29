// Package sqlmongo translates a useful subset of SQL into MongoDB queries.
//
// It is deliberately dependency-free: a small lexer and recursive-descent parser
// turn SELECT statements into either a find query (Filter/Projection/Sort) or an
// aggregation pipeline. Supported syntax:
//
//	SELECT [DISTINCT] (* | expr [AS alias], ...)
//	FROM collection
//	[WHERE condition]
//	[GROUP BY expr, ...]
//	[HAVING condition]
//	[ORDER BY expr [ASC|DESC], ...]
//	[LIMIT n [OFFSET m]]
//
// WHERE supports comparisons (= != <> > >= < <=), IN / NOT IN, LIKE / NOT LIKE,
// IS [NOT] NULL, AND / OR / NOT and parentheses. Aggregates COUNT / SUM / AVG /
// MIN / MAX are supported with GROUP BY and HAVING.
package sqlmongo

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// --- tokens -----------------------------------------------------------------

type tokKind int

const (
	tokEOF tokKind = iota
	tokIdent
	tokString
	tokNumber
	tokKeyword
	tokStar
	tokComma
	tokLParen
	tokRParen
	tokDot
	tokOp
)

type token struct {
	kind tokKind
	text string
	num  float64
	pos  int
}

var keywords = map[string]bool{
	"SELECT": true, "DISTINCT": true, "FROM": true, "WHERE": true,
	"GROUP": true, "BY": true, "HAVING": true, "ORDER": true,
	"ASC": true, "DESC": true, "LIMIT": true, "OFFSET": true,
	"AND": true, "OR": true, "NOT": true, "IN": true, "LIKE": true,
	"IS": true, "NULL": true, "TRUE": true, "FALSE": true, "AS": true,
}

func isIdentStart(c byte) bool {
	return c == '_' || c == '$' || unicode.IsLetter(rune(c))
}

func isIdentPart(c byte) bool {
	return c == '_' || c == '$' || unicode.IsLetter(rune(c)) || unicode.IsDigit(rune(c))
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

type lexer struct {
	input string
	pos   int
}

func (l *lexer) errorf(format string, args ...any) error {
	return fmt.Errorf("SQL syntax error at position %d: %s", l.pos, fmt.Sprintf(format, args...))
}

func (l *lexer) lex() ([]token, error) {
	var toks []token
	for l.pos < len(l.input) {
		c := l.input[l.pos]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			l.pos++
		case c == '-' && l.peekAt(1) == '-':
			for l.pos < len(l.input) && l.input[l.pos] != '\n' {
				l.pos++
			}
		case c == '/' && l.peekAt(1) == '*':
			l.pos += 2
			for l.pos+1 < len(l.input) && !(l.input[l.pos] == '*' && l.input[l.pos+1] == '/') {
				l.pos++
			}
			if l.pos+1 >= len(l.input) {
				return nil, l.errorf("unterminated comment")
			}
			l.pos += 2
		case c == '\'' || c == '"':
			s, err := l.lexString(c)
			if err != nil {
				return nil, err
			}
			toks = append(toks, token{kind: tokString, text: s, pos: l.pos})
		case c == '`':
			l.pos++
			start := l.pos
			for l.pos < len(l.input) && l.input[l.pos] != '`' {
				l.pos++
			}
			if l.pos >= len(l.input) {
				return nil, l.errorf("unterminated quoted identifier")
			}
			toks = append(toks, token{kind: tokIdent, text: l.input[start:l.pos], pos: start})
			l.pos++
		case isDigit(c) || (c == '.' && isDigit(l.peekAt(1))):
			toks = append(toks, l.lexNumber())
		case isIdentStart(c):
			start := l.pos
			for l.pos < len(l.input) && isIdentPart(l.input[l.pos]) {
				l.pos++
			}
			word := l.input[start:l.pos]
			upper := strings.ToUpper(word)
			if keywords[upper] {
				toks = append(toks, token{kind: tokKeyword, text: upper, pos: start})
			} else {
				toks = append(toks, token{kind: tokIdent, text: word, pos: start})
			}
		default:
			t, err := l.lexSymbol()
			if err != nil {
				return nil, err
			}
			toks = append(toks, t)
		}
	}
	toks = append(toks, token{kind: tokEOF, pos: len(l.input)})
	return toks, nil
}

func (l *lexer) peekAt(offset int) byte {
	if l.pos+offset < len(l.input) {
		return l.input[l.pos+offset]
	}
	return 0
}

func (l *lexer) lexString(quote byte) (string, error) {
	l.pos++
	var sb strings.Builder
	for l.pos < len(l.input) {
		c := l.input[l.pos]
		if c == quote {
			if l.peekAt(1) == quote {
				sb.WriteByte(quote)
				l.pos += 2
				continue
			}
			l.pos++
			return sb.String(), nil
		}
		if c == '\\' && l.pos+1 < len(l.input) {
			sb.WriteByte(l.input[l.pos+1])
			l.pos += 2
			continue
		}
		sb.WriteByte(c)
		l.pos++
	}
	return "", l.errorf("unterminated string literal")
}

func (l *lexer) lexNumber() token {
	start := l.pos
	for l.pos < len(l.input) && (isDigit(l.input[l.pos]) || l.input[l.pos] == '.') {
		l.pos++
	}
	if l.pos < len(l.input) && (l.input[l.pos] == 'e' || l.input[l.pos] == 'E') {
		l.pos++
		if l.pos < len(l.input) && (l.input[l.pos] == '+' || l.input[l.pos] == '-') {
			l.pos++
		}
		for l.pos < len(l.input) && isDigit(l.input[l.pos]) {
			l.pos++
		}
	}
	text := l.input[start:l.pos]
	n, _ := strconv.ParseFloat(text, 64)
	return token{kind: tokNumber, text: text, num: n, pos: start}
}

func (l *lexer) lexSymbol() (token, error) {
	pos := l.pos
	switch c := l.input[l.pos]; c {
	case '*':
		l.pos++
		return token{kind: tokStar, text: "*", pos: pos}, nil
	case ',':
		l.pos++
		return token{kind: tokComma, text: ",", pos: pos}, nil
	case '(':
		l.pos++
		return token{kind: tokLParen, text: "(", pos: pos}, nil
	case ')':
		l.pos++
		return token{kind: tokRParen, text: ")", pos: pos}, nil
	case '.':
		l.pos++
		return token{kind: tokDot, text: ".", pos: pos}, nil
	case '=':
		l.pos++
		return token{kind: tokOp, text: "=", pos: pos}, nil
	case '!':
		if l.peekAt(1) == '=' {
			l.pos += 2
			return token{kind: tokOp, text: "!=", pos: pos}, nil
		}
		return token{}, l.errorf("unexpected '!' (did you mean != ?)")
	case '<':
		if l.peekAt(1) == '=' {
			l.pos += 2
			return token{kind: tokOp, text: "<=", pos: pos}, nil
		}
		if l.peekAt(1) == '>' {
			l.pos += 2
			return token{kind: tokOp, text: "<>", pos: pos}, nil
		}
		l.pos++
		return token{kind: tokOp, text: "<", pos: pos}, nil
	case '>':
		if l.peekAt(1) == '=' {
			l.pos += 2
			return token{kind: tokOp, text: ">=", pos: pos}, nil
		}
		l.pos++
		return token{kind: tokOp, text: ">", pos: pos}, nil
	default:
		return token{}, l.errorf("unexpected character %q", c)
	}
}

// --- AST --------------------------------------------------------------------

// Expr is a value or boolean expression.
type Expr interface{ isExpr() }

type Literal struct{ Value any }
type ColumnRef struct{ Name string }
type StarExpr struct{}
type FuncCall struct {
	Name string
	Args []Expr
}
type BinaryExpr struct {
	Op    string
	Left  Expr
	Right Expr
}
type LogicalExpr struct {
	Op    string // AND | OR
	Left  Expr
	Right Expr
}
type NotExpr struct{ Expr Expr }
type InExpr struct {
	Expr   Expr
	Values []Expr
	Not    bool
}
type LikeExpr struct {
	Expr    Expr
	Pattern string
	Not     bool
}
type IsNullExpr struct {
	Expr Expr
	Not  bool
}

func (*Literal) isExpr()    {}
func (*ColumnRef) isExpr()  {}
func (*StarExpr) isExpr()   {}
func (*FuncCall) isExpr()   {}
func (*BinaryExpr) isExpr() {}
func (*LogicalExpr) isExpr() {}
func (*NotExpr) isExpr()    {}
func (*InExpr) isExpr()     {}
func (*LikeExpr) isExpr()   {}
func (*IsNullExpr) isExpr() {}

// SelectItem is one entry of the SELECT list.
type SelectItem struct {
	Expr  Expr
	Alias string
	Star  bool
}

// OrderItem is one entry of ORDER BY.
type OrderItem struct {
	Expr Expr
	Desc bool
}

// Statement is the parsed query.
type Statement struct {
	Collection string
	Distinct   bool
	Select     []SelectItem
	Where      Expr
	GroupBy    []Expr
	Having     Expr
	OrderBy    []OrderItem
	Limit      int64
	HasLimit   bool
	Offset     int64
}

// --- parser -----------------------------------------------------------------

type parser struct {
	toks []token
	pos  int
}

func Parse(input string) (*Statement, error) {
	toks, err := (&lexer{input: input}).lex()
	if err != nil {
		return nil, err
	}
	p := &parser{toks: toks}
	return p.parseStatement()
}

func (p *parser) peek() token { return p.toks[p.pos] }

func (p *parser) next() token {
	t := p.toks[p.pos]
	if t.kind != tokEOF {
		p.pos++
	}
	return t
}

func (p *parser) errorf(format string, args ...any) error {
	t := p.peek()
	return fmt.Errorf("SQL syntax error near %q: %s", t.text, fmt.Sprintf(format, args...))
}

func (p *parser) isKeyword(kw string) bool {
	t := p.peek()
	return t.kind == tokKeyword && t.text == kw
}

func (p *parser) acceptKeyword(kw string) bool {
	if p.isKeyword(kw) {
		p.next()
		return true
	}
	return false
}

func (p *parser) expectKeyword(kw string) error {
	if !p.acceptKeyword(kw) {
		return p.errorf("expected %s", kw)
	}
	return nil
}

func (p *parser) expect(kind tokKind, what string) (token, error) {
	if p.peek().kind != kind {
		return token{}, p.errorf("expected %s", what)
	}
	return p.next(), nil
}

func (p *parser) parseStatement() (*Statement, error) {
	if err := p.expectKeyword("SELECT"); err != nil {
		return nil, err
	}
	st := &Statement{}
	if p.acceptKeyword("DISTINCT") {
		st.Distinct = true
	}

	selectList, err := p.parseSelectList()
	if err != nil {
		return nil, err
	}
	st.Select = selectList

	if err := p.expectKeyword("FROM"); err != nil {
		return nil, err
	}
	name, err := p.parseName()
	if err != nil {
		return nil, err
	}
	st.Collection = name

	if p.acceptKeyword("WHERE") {
		if st.Where, err = p.parseOr(); err != nil {
			return nil, err
		}
	}
	if p.acceptKeyword("GROUP") {
		if err := p.expectKeyword("BY"); err != nil {
			return nil, err
		}
		if st.GroupBy, err = p.parseExprList(); err != nil {
			return nil, err
		}
	}
	if p.acceptKeyword("HAVING") {
		if st.Having, err = p.parseOr(); err != nil {
			return nil, err
		}
	}
	if p.acceptKeyword("ORDER") {
		if err := p.expectKeyword("BY"); err != nil {
			return nil, err
		}
		if st.OrderBy, err = p.parseOrderList(); err != nil {
			return nil, err
		}
	}
	if p.acceptKeyword("LIMIT") {
		n, err := p.parseUint()
		if err != nil {
			return nil, err
		}
		st.Limit, st.HasLimit = int64(n), true
		if p.acceptKeyword("OFFSET") {
			m, err := p.parseUint()
			if err != nil {
				return nil, err
			}
			st.Offset = int64(m)
		} else if p.peek().kind == tokComma { // MySQL: LIMIT offset, count
			p.next()
			m, err := p.parseUint()
			if err != nil {
				return nil, err
			}
			st.Offset, st.Limit = st.Limit, int64(m)
		}
	} else if p.acceptKeyword("OFFSET") {
		m, err := p.parseUint()
		if err != nil {
			return nil, err
		}
		st.Offset = int64(m)
	}

	if p.peek().kind != tokEOF {
		return nil, p.errorf("unexpected %q", p.peek().text)
	}
	return st, nil
}

func (p *parser) parseSelectList() ([]SelectItem, error) {
	var items []SelectItem
	for {
		if p.peek().kind == tokStar {
			p.next()
			items = append(items, SelectItem{Star: true})
		} else {
			expr, err := p.parseValueExpr()
			if err != nil {
				return nil, err
			}
			item := SelectItem{Expr: expr}
			if p.acceptKeyword("AS") {
				alias, err := p.parseAlias()
				if err != nil {
					return nil, err
				}
				item.Alias = alias
			} else if p.peek().kind == tokIdent {
				item.Alias = p.next().text
			}
			items = append(items, item)
		}
		if p.peek().kind != tokComma {
			break
		}
		p.next()
	}
	return items, nil
}

func (p *parser) parseAlias() (string, error) {
	t := p.peek()
	if t.kind == tokIdent || t.kind == tokString {
		p.next()
		return t.text, nil
	}
	return "", p.errorf("expected an alias")
}

func (p *parser) parseExprList() ([]Expr, error) {
	var exprs []Expr
	for {
		e, err := p.parseValueExpr()
		if err != nil {
			return nil, err
		}
		exprs = append(exprs, e)
		if p.peek().kind != tokComma {
			break
		}
		p.next()
	}
	return exprs, nil
}

func (p *parser) parseOrderList() ([]OrderItem, error) {
	var items []OrderItem
	for {
		e, err := p.parseValueExpr()
		if err != nil {
			return nil, err
		}
		item := OrderItem{Expr: e}
		if p.acceptKeyword("DESC") {
			item.Desc = true
		} else {
			p.acceptKeyword("ASC")
		}
		items = append(items, item)
		if p.peek().kind != tokComma {
			break
		}
		p.next()
	}
	return items, nil
}

func (p *parser) parseValueExpr() (Expr, error) {
	t := p.peek()
	switch t.kind {
	case tokNumber:
		p.next()
		if !strings.ContainsAny(t.text, ".eE") {
			if n, err := strconv.ParseInt(t.text, 10, 64); err == nil {
				return &Literal{Value: n}, nil
			}
		}
		return &Literal{Value: t.num}, nil
	case tokString:
		p.next()
		return &Literal{Value: t.text}, nil
	case tokKeyword:
		switch t.text {
		case "NULL":
			p.next()
			return &Literal{Value: nil}, nil
		case "TRUE":
			p.next()
			return &Literal{Value: true}, nil
		case "FALSE":
			p.next()
			return &Literal{Value: false}, nil
		}
		return nil, p.errorf("unexpected keyword %s in expression", t.text)
	case tokIdent:
		if p.toks[p.pos+1].kind == tokLParen {
			return p.parseFuncCall()
		}
		name, err := p.parseName()
		if err != nil {
			return nil, err
		}
		return &ColumnRef{Name: name}, nil
	case tokLParen:
		p.next()
		e, err := p.parseOr()
		if err != nil {
			return nil, err
		}
		if _, err := p.expect(tokRParen, ")"); err != nil {
			return nil, err
		}
		return e, nil
	}
	return nil, p.errorf("expected a value")
}

func (p *parser) parseFuncCall() (Expr, error) {
	name := p.next().text
	p.next() // consume '('
	var args []Expr
	if p.peek().kind == tokStar {
		p.next()
		args = append(args, &StarExpr{})
	} else if p.peek().kind != tokRParen {
		for {
			e, err := p.parseValueExpr()
			if err != nil {
				return nil, err
			}
			args = append(args, e)
			if p.peek().kind != tokComma {
				break
			}
			p.next()
		}
	}
	if _, err := p.expect(tokRParen, ")"); err != nil {
		return nil, err
	}
	return &FuncCall{Name: strings.ToUpper(name), Args: args}, nil
}

// parseName reads a possibly dotted field / collection name.
func (p *parser) parseName() (string, error) {
	t := p.peek()
	if t.kind != tokIdent {
		return "", p.errorf("expected an identifier")
	}
	p.next()
	name := t.text
	for p.peek().kind == tokDot {
		p.next()
		next := p.peek()
		if next.kind != tokIdent && next.kind != tokStar {
			return "", p.errorf("expected a field name after '.'")
		}
		p.next()
		name += "." + next.text
	}
	return name, nil
}

func (p *parser) parseUint() (int64, error) {
	t := p.peek()
	if t.kind != tokNumber {
		return 0, p.errorf("expected a number")
	}
	p.next()
	n, err := strconv.ParseInt(t.text, 10, 64)
	if err != nil || n < 0 {
		return 0, p.errorf("expected a non-negative integer")
	}
	return n, nil
}

// --- boolean expression parsing ---------------------------------------------

func (p *parser) parseOr() (Expr, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for p.acceptKeyword("OR") {
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = &LogicalExpr{Op: "OR", Left: left, Right: right}
	}
	return left, nil
}

func (p *parser) parseAnd() (Expr, error) {
	left, err := p.parseNot()
	if err != nil {
		return nil, err
	}
	for p.acceptKeyword("AND") {
		right, err := p.parseNot()
		if err != nil {
			return nil, err
		}
		left = &LogicalExpr{Op: "AND", Left: left, Right: right}
	}
	return left, nil
}

func (p *parser) parseNot() (Expr, error) {
	if p.acceptKeyword("NOT") {
		e, err := p.parseNot()
		if err != nil {
			return nil, err
		}
		return &NotExpr{Expr: e}, nil
	}
	return p.parseComparison()
}

func (p *parser) parseComparison() (Expr, error) {
	left, err := p.parseOperand()
	if err != nil {
		return nil, err
	}

	t := p.peek()
	switch {
	case t.kind == tokOp:
		p.next()
		right, err := p.parseOperand()
		if err != nil {
			return nil, err
		}
		return &BinaryExpr{Op: t.text, Left: left, Right: right}, nil
	case p.isKeyword("IS"):
		p.next()
		not := p.acceptKeyword("NOT")
		if err := p.expectKeyword("NULL"); err != nil {
			return nil, err
		}
		return &IsNullExpr{Expr: left, Not: not}, nil
	case p.isKeyword("IN"):
		p.next()
		values, err := p.parseValueList()
		if err != nil {
			return nil, err
		}
		return &InExpr{Expr: left, Values: values}, nil
	case p.isKeyword("NOT"):
		p.next()
		switch {
		case p.acceptKeyword("IN"):
			values, err := p.parseValueList()
			if err != nil {
				return nil, err
			}
			return &InExpr{Expr: left, Values: values, Not: true}, nil
		case p.acceptKeyword("LIKE"):
			pattern, err := p.parseLikePattern()
			if err != nil {
				return nil, err
			}
			return &LikeExpr{Expr: left, Pattern: pattern, Not: true}, nil
		default:
			return nil, p.errorf("expected IN or LIKE after NOT")
		}
	case p.isKeyword("LIKE"):
		p.next()
		pattern, err := p.parseLikePattern()
		if err != nil {
			return nil, err
		}
		return &LikeExpr{Expr: left, Pattern: pattern}, nil
	}
	return left, nil
}

func (p *parser) parseOperand() (Expr, error) {
	if p.peek().kind == tokLParen {
		p.next()
		e, err := p.parseOr()
		if err != nil {
			return nil, err
		}
		if _, err := p.expect(tokRParen, ")"); err != nil {
			return nil, err
		}
		return e, nil
	}
	return p.parseValueExpr()
}

func (p *parser) parseValueList() ([]Expr, error) {
	if _, err := p.expect(tokLParen, "("); err != nil {
		return nil, err
	}
	var values []Expr
	for {
		e, err := p.parseValueExpr()
		if err != nil {
			return nil, err
		}
		values = append(values, e)
		if p.peek().kind != tokComma {
			break
		}
		p.next()
	}
	if _, err := p.expect(tokRParen, ")"); err != nil {
		return nil, err
	}
	return values, nil
}

func (p *parser) parseLikePattern() (string, error) {
	t := p.peek()
	if t.kind != tokString {
		return "", p.errorf("LIKE expects a string pattern")
	}
	p.next()
	return t.text, nil
}

package mongoscript

import (
	"fmt"
	"strings"
)

// Call is a single method invocation in a statement chain.
type Call struct {
	Name string
	Args []any
}

// Statement is one parsed top-level command.
//
// Kind is "use" for a `use <db>` directive and "call" for a `db...` chain.
// Database is an override set by `getSiblingDB`; the empty string means the
// script's default database. Collection is empty for database-level calls.
type Statement struct {
	Kind       string
	Use        string
	Database   string
	Collection string
	Calls      []Call
	Source     string
}

type parser struct {
	src  string
	toks []token
	pos  int
}

// Parse turns a script into a list of statements. It accepts an empty script.
func Parse(input string) ([]Statement, error) {
	toks, err := (&lexer{input: input}).lex()
	if err != nil {
		return nil, err
	}
	p := &parser{src: input, toks: toks}
	return p.parseScript()
}

func (p *parser) peek() token { return p.toks[p.pos] }
func (p *parser) next() token { t := p.toks[p.pos]; p.pos++; return t }
func (p *parser) atEOF() bool { return p.peek().kind == tEOF }
func (p *parser) errorf(format string, args ...any) error {
	return fmt.Errorf("script syntax error at position %d: %s", p.peek().pos, fmt.Sprintf(format, args...))
}

func (p *parser) expect(kind tokKind, what string) (token, error) {
	t := p.peek()
	if t.kind != kind {
		return token{}, p.errorf("expected %s, got %s", what, t)
	}
	p.pos++
	return t, nil
}

func (p *parser) parseScript() ([]Statement, error) {
	var stmts []Statement
	for !p.atEOF() {
		for p.peek().kind == tSemi {
			p.next()
		}
		if p.atEOF() {
			break
		}
		start := p.peek().pos
		stmt, err := p.parseStatement()
		if err != nil {
			return nil, err
		}
		stmt.Source = strings.TrimSpace(p.src[start:p.peek().pos])
		stmts = append(stmts, stmt)
		// A statement chain must be followed by ';', a new statement, or EOF.
		if p.peek().kind == tSemi {
			p.next()
		}
	}
	return stmts, nil
}

func (p *parser) parseStatement() (Statement, error) {
	t := p.peek()
	if t.kind != tIdent || t.text != "db" {
		if t.kind == tIdent && t.text == "use" {
			return p.parseUse()
		}
		return Statement{}, p.errorf("statement must start with \"db\" (got %s)", t)
	}
	p.next()

	stmt := Statement{Kind: "call"}
	for p.peek().kind == tDot {
		p.next()
		name, err := p.expect(tIdent, "a collection or method name")
		if err != nil {
			return Statement{}, err
		}
		if p.peek().kind == tLParen {
			args, err := p.parseArgs()
			if err != nil {
				return Statement{}, err
			}
			switch {
			case name.text == "getCollection" && stmt.Collection == "" && len(stmt.Calls) == 0:
				coll, ok := firstStringArg(args)
				if !ok {
					return Statement{}, p.errorf("getCollection() expects a collection name string")
				}
				stmt.Collection = coll
			case name.text == "getSiblingDB" && len(stmt.Calls) == 0:
				db, ok := firstStringArg(args)
				if !ok {
					return Statement{}, p.errorf("getSiblingDB() expects a database name string")
				}
				stmt.Database = db
				stmt.Collection = ""
			default:
				stmt.Calls = append(stmt.Calls, Call{Name: name.text, Args: args})
			}
			continue
		}
		// A bare name selects a collection; it may only appear once, first.
		if stmt.Collection != "" || len(stmt.Calls) > 0 {
			return Statement{}, p.errorf("unexpected name %q in statement chain", name.text)
		}
		stmt.Collection = name.text
	}
	if len(stmt.Calls) == 0 {
		return Statement{}, p.errorf("statement %q has no operation", stmt.Collection)
	}
	return stmt, nil
}

func (p *parser) parseUse() (Statement, error) {
	p.next() // "use"
	t := p.peek()
	var name string
	switch t.kind {
	case tIdent:
		name = t.text
		p.next()
	case tString:
		name = t.text
		p.next()
	default:
		return Statement{}, p.errorf("use expects a database name")
	}
	return Statement{Kind: "use", Use: name}, nil
}

func (p *parser) parseArgs() ([]any, error) {
	if _, err := p.expect(tLParen, "("); err != nil {
		return nil, err
	}
	args := []any{}
	if p.peek().kind == tRParen {
		p.next()
		return args, nil
	}
	for {
		value, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		args = append(args, value)
		switch p.peek().kind {
		case tComma:
			p.next()
			if p.peek().kind == tRParen { // trailing comma
				p.next()
				return args, nil
			}
		case tRParen:
			p.next()
			return args, nil
		default:
			return nil, p.errorf("expected ',' or ')', got %s", p.peek())
		}
	}
}

// ParseStatements exposes parsing for callers that only need the AST.
func ParseStatements(input string) ([]Statement, error) { return Parse(input) }

func firstStringArg(args []any) (string, bool) {
	if len(args) == 0 {
		return "", false
	}
	s, ok := args[0].(string)
	return s, ok
}

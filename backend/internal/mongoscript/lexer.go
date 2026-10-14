// Package mongoscript parses and runs a practical subset of mongosh-style
// JavaScript against a MongoDB database.
//
// A script is a sequence of statements separated by ';' or newlines:
//
//	use shop
//	db.users.find({ status: "active" }).sort({ age: -1 }).limit(20)
//	db.users.updateOne({ _id: ObjectId("...") }, { $set: { active: true } })
//
// Only the documented shell helpers and collection methods are understood;
// arbitrary JavaScript (variables, loops, functions) is rejected with a clear
// syntax error rather than silently ignored.
package mongoscript

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

type tokKind int

const (
	tEOF tokKind = iota
	tIdent
	tString
	tNumber
	tLBrace
	tRBrace
	tLBracket
	tRBracket
	tLParen
	tRParen
	tColon
	tComma
	tDot
	tSemi
	tMinus
)

type token struct {
	kind  tokKind
	text  string
	num   float64
	isInt bool
	pos   int
}

func (t token) String() string {
	if t.kind == tEOF {
		return "end of script"
	}
	if t.text != "" {
		return strconv.Quote(t.text)
	}
	return fmt.Sprintf("%q", t.text)
}

type lexer struct {
	input string
	pos   int
}

func (l *lexer) errorf(format string, args ...any) error {
	return fmt.Errorf("script syntax error at position %d: %s", l.pos, fmt.Sprintf(format, args...))
}

func (l *lexer) lex() ([]token, error) {
	var toks []token
	for l.pos < len(l.input) {
		c := l.input[l.pos]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			l.pos++
		case c == '/' && l.peekAt(1) == '/':
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
		case c == '\'' || c == '"' || c == '`':
			s, err := l.lexString(c)
			if err != nil {
				return nil, err
			}
			toks = append(toks, token{kind: tString, text: s, pos: l.pos})
		case c >= '0' && c <= '9':
			toks = append(toks, l.lexNumber())
		case c == '$' || c == '_' || isLetter(c):
			toks = append(toks, l.lexIdent())
		default:
			t, err := l.lexSymbol()
			if err != nil {
				return nil, err
			}
			toks = append(toks, t)
		}
	}
	toks = append(toks, token{kind: tEOF, pos: len(l.input)})
	return toks, nil
}

func (l *lexer) peekAt(offset int) byte {
	if l.pos+offset < len(l.input) {
		return l.input[l.pos+offset]
	}
	return 0
}

func isLetter(c byte) bool {
	return c < utf8.RuneSelf && (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z')
}

func isIdentStart(c byte) bool {
	return isLetter(c) || c == '_' || c == '$'
}

func isIdentPart(c byte) bool {
	return isLetter(c) || c == '_' || c == '$' || c >= '0' && c <= '9'
}

func (l *lexer) lexIdent() token {
	start := l.pos
	for l.pos < len(l.input) {
		if !isIdentPart(l.input[l.pos]) {
			break
		}
		l.pos++
	}
	return token{kind: tIdent, text: l.input[start:l.pos], pos: start}
}

func (l *lexer) lexString(quote byte) (string, error) {
	l.pos++
	var sb strings.Builder
	for l.pos < len(l.input) {
		c := l.input[l.pos]
		if c == quote {
			l.pos++
			return sb.String(), nil
		}
		if c == '\\' && l.pos+1 < len(l.input) {
			esc := l.input[l.pos+1]
			switch esc {
			case 'n':
				sb.WriteByte('\n')
			case 't':
				sb.WriteByte('\t')
			case 'r':
				sb.WriteByte('\r')
			case 'b':
				sb.WriteByte('\b')
			case 'f':
				sb.WriteByte('\f')
			case '0':
				sb.WriteByte(0)
			case 'u':
				if l.pos+5 < len(l.input) {
					if r, err := strconv.ParseUint(l.input[l.pos+2:l.pos+6], 16, 32); err == nil {
						sb.WriteRune(rune(r))
						l.pos += 6
						continue
					}
				}
				sb.WriteByte(esc)
			default:
				sb.WriteByte(esc)
			}
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
	isInt := true
	for l.pos < len(l.input) && l.input[l.pos] >= '0' && l.input[l.pos] <= '9' {
		l.pos++
	}
	if l.pos < len(l.input) && l.input[l.pos] == '.' {
		isInt = false
		l.pos++
		for l.pos < len(l.input) && l.input[l.pos] >= '0' && l.input[l.pos] <= '9' {
			l.pos++
		}
	}
	if l.pos < len(l.input) && (l.input[l.pos] == 'e' || l.input[l.pos] == 'E') {
		isInt = false
		l.pos++
		if l.pos < len(l.input) && (l.input[l.pos] == '+' || l.input[l.pos] == '-') {
			l.pos++
		}
		for l.pos < len(l.input) && l.input[l.pos] >= '0' && l.input[l.pos] <= '9' {
			l.pos++
		}
	}
	text := l.input[start:l.pos]
	n, _ := strconv.ParseFloat(text, 64)
	return token{kind: tNumber, text: text, num: n, isInt: isInt, pos: start}
}

func (l *lexer) lexSymbol() (token, error) {
	pos := l.pos
	c := l.input[l.pos]
	l.pos++
	switch c {
	case '{':
		return token{kind: tLBrace, text: "{", pos: pos}, nil
	case '}':
		return token{kind: tRBrace, text: "}", pos: pos}, nil
	case '[':
		return token{kind: tLBracket, text: "[", pos: pos}, nil
	case ']':
		return token{kind: tRBracket, text: "]", pos: pos}, nil
	case '(':
		return token{kind: tLParen, text: "(", pos: pos}, nil
	case ')':
		return token{kind: tRParen, text: ")", pos: pos}, nil
	case ':':
		return token{kind: tColon, text: ":", pos: pos}, nil
	case ',':
		return token{kind: tComma, text: ",", pos: pos}, nil
	case '.':
		return token{kind: tDot, text: ".", pos: pos}, nil
	case ';':
		return token{kind: tSemi, text: ";", pos: pos}, nil
	case '-':
		return token{kind: tMinus, text: "-", pos: pos}, nil
	default:
		r, _ := utf8.DecodeRuneInString(l.input[pos:])
		if unicode.IsLetter(r) {
			l.pos = pos
			return l.lexIdent(), nil
		}
		return token{}, l.errorf("unexpected character %q", c)
	}
}

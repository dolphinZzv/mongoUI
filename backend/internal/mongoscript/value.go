package mongoscript

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// parseValue parses a JavaScript literal (object, array, string, number,
// boolean, null) or one of the supported BSON constructor helpers into a value
// the mongo-driver understands.
func (p *parser) parseValue() (any, error) {
	t := p.peek()
	switch t.kind {
	case tString:
		p.next()
		return t.text, nil
	case tNumber:
		p.next()
		return numberValue(t), nil
	case tMinus:
		p.next()
		n := p.peek()
		if n.kind != tNumber {
			return nil, p.errorf("expected a number after '-'")
		}
		p.next()
		value := numberValue(n)
		switch v := value.(type) {
		case int64:
			return -v, nil
		default:
			return -v.(float64), nil
		}
	case tLBrace:
		return p.parseObject()
	case tLBracket:
		return p.parseArray()
	case tIdent:
		switch t.text {
		case "true":
			p.next()
			return true, nil
		case "false":
			p.next()
			return false, nil
		case "null", "undefined":
			p.next()
			return nil, nil
		case "new":
			p.next()
			return p.parseConstructor()
		case "Infinity", "NaN":
			p.next()
			return nil, nil
		}
		if p.peekAt(1).kind == tLParen {
			return p.parseConstructor()
		}
		return nil, p.errorf("unexpected identifier %q (variables and expressions are not supported)", t.text)
	default:
		return nil, p.errorf("unexpected %s where a value was expected", t)
	}
}

func (p *parser) peekAt(offset int) token {
	idx := p.pos + offset
	if idx >= len(p.toks) {
		return token{kind: tEOF}
	}
	return p.toks[idx]
}

func numberValue(t token) any {
	if t.isInt {
		if n, err := strconv.ParseInt(t.text, 10, 64); err == nil {
			return n
		}
	}
	return t.num
}

func (p *parser) parseObject() (bson.D, error) {
	if _, err := p.expect(tLBrace, "{"); err != nil {
		return nil, err
	}
	doc := bson.D{}
	if p.peek().kind == tRBrace {
		p.next()
		return doc, nil
	}
	for {
		keyTok := p.peek()
		var key string
		switch keyTok.kind {
		case tIdent, tString:
			key = keyTok.text
		case tNumber:
			key = keyTok.text
		default:
			return nil, p.errorf("expected an object key, got %s", keyTok)
		}
		p.next()
		if _, err := p.expect(tColon, ":"); err != nil {
			return nil, err
		}
		value, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		doc = append(doc, bson.E{Key: key, Value: value})
		switch p.peek().kind {
		case tComma:
			p.next()
			if p.peek().kind == tRBrace {
				p.next()
				return doc, nil
			}
		case tRBrace:
			p.next()
			return doc, nil
		default:
			return nil, p.errorf("expected ',' or '}', got %s", p.peek())
		}
	}
}

func (p *parser) parseArray() ([]any, error) {
	if _, err := p.expect(tLBracket, "["); err != nil {
		return nil, err
	}
	values := []any{}
	if p.peek().kind == tRBracket {
		p.next()
		return values, nil
	}
	for {
		value, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		values = append(values, value)
		switch p.peek().kind {
		case tComma:
			p.next()
			if p.peek().kind == tRBracket {
				p.next()
				return values, nil
			}
		case tRBracket:
			p.next()
			return values, nil
		default:
			return nil, p.errorf("expected ',' or ']', got %s", p.peek())
		}
	}
}

// parseConstructor parses ObjectId(...), ISODate(...), new Date(...), etc.
func (p *parser) parseConstructor() (any, error) {
	nameTok, err := p.expect(tIdent, "a constructor name")
	if err != nil {
		return nil, err
	}
	args, err := p.parseArgs()
	if err != nil {
		return nil, err
	}
	name := nameTok.text
	switch name {
	case "ObjectId", "ObjectID", "ObjectIDHex":
		s, ok := firstStringArg(args)
		if !ok {
			return nil, p.errorf("%s() expects a hex string", name)
		}
		oid, err := primitive.ObjectIDFromHex(s)
		if err != nil {
			return nil, fmt.Errorf("invalid ObjectId %q: %w", s, err)
		}
		return oid, nil
	case "ISODate", "Date":
		s, ok := firstStringArg(args)
		if !ok {
			return nil, p.errorf("%s() expects a date string", name)
		}
		return parseDate(s)
	case "NumberLong":
		return intFromArgs(args, name)
	case "NumberInt":
		n, err := intFromArgs(args, name)
		if err != nil {
			return nil, err
		}
		return int32(n), nil
	case "NumberDecimal":
		s, ok := firstStringArg(args)
		if !ok {
			return nil, p.errorf("NumberDecimal() expects a string")
		}
		dec, err := primitive.ParseDecimal128(s)
		if err != nil {
			return nil, fmt.Errorf("invalid NumberDecimal %q: %w", s, err)
		}
		return dec, nil
	case "Timestamp":
		sec := toInt64(args, 0)
		inc := toInt64(args, 1)
		return primitive.Timestamp{T: uint32(sec), I: uint32(inc)}, nil
	case "UUID":
		s, ok := firstStringArg(args)
		if !ok {
			return nil, p.errorf("UUID() expects a string")
		}
		data, err := parseUUID(s)
		if err != nil {
			return nil, err
		}
		return primitive.Binary{Subtype: 0x04, Data: data}, nil
	case "BinData":
		sub := byte(toInt64(args, 0))
		s, ok := firstStringArg(args[1:])
		if !ok {
			return nil, p.errorf("BinData() expects (subtype, base64)")
		}
		data, err := decodeBase64(s)
		if err != nil {
			return nil, err
		}
		return primitive.Binary{Subtype: sub, Data: data}, nil
	case "MinKey":
		return primitive.MinKey{}, nil
	case "MaxKey":
		return primitive.MaxKey{}, nil
	case "RegExp":
		pattern, ok := firstStringArg(args)
		if !ok {
			return nil, p.errorf("RegExp() expects a pattern")
		}
		options := ""
		if len(args) > 1 {
			options, _ = args[1].(string)
		}
		return primitive.Regex{Pattern: pattern, Options: options}, nil
	default:
		return nil, p.errorf("unsupported constructor %s()", name)
	}
}

func intFromArgs(args []any, name string) (int64, error) {
	if len(args) == 0 {
		return 0, nil
	}
	switch v := args[0].(type) {
	case int64:
		return v, nil
	case int32:
		return int64(v), nil
	case float64:
		return int64(v), nil
	case string:
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("%s: invalid number %q", name, v)
		}
		return n, nil
	default:
		return 0, fmt.Errorf("%s: expects a number", name)
	}
}

func toInt64(args []any, i int) int64 {
	if i >= len(args) {
		return 0
	}
	switch v := args[i].(type) {
	case int64:
		return v
	case int32:
		return int64(v)
	case float64:
		return int64(v)
	case string:
		n, _ := strconv.ParseInt(v, 10, 64)
		return n
	default:
		return 0
	}
}

var dateLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02T15:04:05.999",
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"2006-01-02",
}

func parseDate(s string) (time.Time, error) {
	for _, layout := range dateLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid date %q", s)
}

func parseUUID(s string) ([]byte, error) {
	clean := strings.ReplaceAll(s, "-", "")
	data, err := hex.DecodeString(clean)
	if err != nil || len(data) != 16 {
		return nil, fmt.Errorf("invalid UUID %q", s)
	}
	return data, nil
}

func decodeBase64(s string) ([]byte, error) {
	data, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 %q", s)
	}
	return data, nil
}

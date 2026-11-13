import { describe, expect, it } from "vitest"

import {
  classForType,
  collectColumns,
  documentId,
  formatBytes,
  formatValue,
  isPlainObject,
  prettyJSON,
  valueType,
} from "@/lib/mongo"

describe("mongo helpers", () => {
  it("classifies Extended JSON values", () => {
    expect(valueType(null)).toBe("null")
    expect(valueType([])).toBe("array")
    expect(valueType({ $oid: "x" })).toBe("objectId")
    expect(valueType({ $date: "x" })).toBe("date")
    expect(valueType({ $numberLong: "1" })).toBe("long")
    expect(valueType({ a: 1 })).toBe("object")
    expect(valueType(1)).toBe("int")
    expect(valueType(1.5)).toBe("double")
    expect(valueType(true)).toBe("bool")
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject([])).toBe(false)
  })

  it("formats scalar and Extended JSON values", () => {
    expect(formatValue(null)).toBe("null")
    expect(formatValue({ $oid: "abc" })).toBe("abc")
    expect(formatValue({ $numberDecimal: "1.5" })).toBe("1.5")
    expect(formatValue({ $date: "2024-01-01T00:00:00Z" })).toBe("2024-01-01T00:00:00Z")
    expect(formatValue({ $regularExpression: { pattern: "^a", options: "i" } })).toBe("/^a/")
    expect(formatValue([1, 2])).toBe("[1,2]")
    expect(formatValue("x")).toBe("x")
  })

  it("collects columns with _id first and stable ids", () => {
    const docs = [{ name: "a" }, { _id: 1, extra: true }]
    expect(collectColumns(docs)).toEqual(["_id", "name", "extra"])
    expect(documentId({ _id: 1 })).toBe("1")
    expect(documentId({ name: "x" })).toBeNull()
    expect(prettyJSON({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it("formats bytes and type classes", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB")
    expect(classForType("objectId")).toContain("amber")
    expect(classForType("unknown")).toContain("foreground")
  })
})

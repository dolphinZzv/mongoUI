import { describe, expect, it } from "vitest"

import { jsonError, jsonObjectError } from "./jsonText"

describe("jsonError", () => {
  it("accepts valid JSON and empty input", () => {
    expect(jsonError("")).toBeNull()
    expect(jsonError('{"a":1}')).toBeNull()
  })

  it("adds a line/column when the engine reports a position", () => {
    const error = jsonError('{\n  "a": 1,\n  "b": }')
    expect(error).toMatch(/line 3, column 8/)
  })

  it("rejects non-object filters with a product hint", () => {
    expect(jsonObjectError("[]")).toContain("expected a JSON object")
    expect(jsonObjectError("42")).toContain("expected a JSON object")
    expect(jsonObjectError('{"a":1}')).toBeNull()
  })
})

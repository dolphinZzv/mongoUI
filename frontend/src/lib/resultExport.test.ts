import { describe, expect, it } from "vitest"

import { resultExportName, resultToCSV, resultToJSON } from "./resultExport"

describe("result export", () => {
  const docs = [
    { _id: "a", name: "Alice", nested: { score: 1 }, formula: "=cmd" },
    { _id: "b", name: "Bob", extra: "x" },
  ]

  it("keeps JSON lossless and pretty-printed", () => {
    expect(JSON.parse(resultToJSON(docs))).toEqual(docs)
  })

  it("builds a stable CSV with union headers and a safe formula cell", () => {
    const csv = resultToCSV(docs)
    const lines = csv.trimEnd().split("\n")
    expect(lines[0]).toBe("_id,name,nested,formula,extra")
    expect(lines[1]).toContain(`"{""score"":1}"`)
    expect(lines[1]).toContain("'=cmd")
    expect(lines[2]).toBe("b,Bob,,,x")
  })

  it("creates a filesystem-safe export name", () => {
    expect(resultExportName("sql:conn:db:users", "csv")).toBe("sql-conn-db-users.csv")
    expect(resultExportName("", "json")).toBe("query-result.json")
  })
})

import { describe, expect, it } from "vitest"

import { toAggregateJS, toFindJS, toSQL } from "@/lib/queryText"

describe("query text exporters", () => {
  it("renders SQL filters, projection, sort and pagination", () => {
    const sql = toSQL("users", {
      filter: JSON.stringify({ status: "ok", age: { $gte: 18 }, name: { $regex: "^A" } }),
      projection: JSON.stringify({ name: 1, age: 1 }),
      sort: JSON.stringify({ age: -1 }),
      limit: 10,
      skip: 5,
    })
    expect(sql).toContain('SELECT "name", "age" FROM "users"')
    expect(sql).toContain('"status" = \'ok\'')
    expect(sql).toContain('"age" >= 18')
    expect(sql).toContain('"name" REGEXP \'^A\'')
    expect(sql).toContain('ORDER BY "age" DESC')
    expect(sql).toContain("LIMIT 10 OFFSET 5;")
  })

  it("explains unsupported filters and invalid JSON", () => {
    expect(toSQL("users", { filter: "{bad" })).toContain("could not parse")
    expect(toSQL("users", { filter: JSON.stringify({ $where: "1" }) })).toContain(
      "cannot be expressed",
    )
  })

  it("renders mongosh find and aggregate chains", () => {
    expect(
      toFindJS("users", { filter: '{"a":1}', sort: '{"a":-1}', limit: 2, skip: 1 }),
    ).toBe('db.users.find({"a":1}).sort({"a":-1}).skip(1).limit(2)')
    expect(toAggregateJS("users", '[{"$limit":1}]')).toBe('db.users.aggregate([{"$limit":1}])')
    expect(toAggregateJS("users", "[]", "analytics")).toBe(
      'db.getSiblingDB("analytics").users.aggregate([])',
    )
  })
})

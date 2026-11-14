import { describe, expect, it } from "vitest"

import {
  DOCS_QUERY_DEFAULTS,
  buildPath,
  decodeChartParam,
  encodeChartParam,
  parseLocation,
  type ChartShareState,
} from "@/lib/router"
import type { Selection } from "@/lib/types"

const collection: Selection = {
  kind: "collection",
  connectionId: "conn 1",
  database: "db/one",
  collection: "users?x",
}
const chart: ChartShareState = {
  config: { type: "line", x: "createdAt", y: ["amount"], aggregate: "sum" } as ChartShareState["config"],
  filter: '{"region":"EMEA"}',
}

describe("buildPath", () => {
  it("encodes welcome, connection and collection routes", () => {
    expect(buildPath({ kind: "welcome" })).toBe("/")
    expect(buildPath({ kind: "dashboard" })).toBe("/dashboard")
    expect(buildPath({ kind: "connection", connectionId: "a/b" })).toBe("/connections/a%2Fb")
    expect(buildPath(collection)).toBe(
      "/connections/conn%201/databases/db%2Fone/collections/users%3Fx",
    )
  })

  it("mirrors documents state and ignores it on other tabs", () => {
    const docs = {
      ...DOCS_QUERY_DEFAULTS,
      filter: '{"status":"ok"}',
      limit: 25,
      skip: 50,
      pinned: ["_id", "name"],
      chart,
    }
    const path = buildPath(collection, "documents", docs)
    expect(path).toContain("filter=%7B%22status%22%3A%22ok%22%7D")
    expect(path).toContain("limit=25")
    expect(path).toContain("skip=50")
    expect(path).toContain("pin=_id")
    expect(path).toContain("chart=")
    expect(buildPath(collection, "query", docs)).not.toContain("filter=")
  })

  it("keeps an explicit empty pinned list and ignores unknown tabs", () => {
    const path = buildPath(collection, "documents", { ...DOCS_QUERY_DEFAULTS, pinned: [] })
    expect(path).toContain("pin=")
    expect(buildPath(collection, "bogus", DOCS_QUERY_DEFAULTS)).not.toContain("tab=")
  })
})

describe("parseLocation", () => {
  it("restores documents state, pins and charts", () => {
    const path = buildPath(
      collection,
      "documents",
      { ...DOCS_QUERY_DEFAULTS, filter: '{"a":1}', limit: 25, skip: 5, pinned: [], chart },
    )
    const parsed = parseLocation(path.split("?")[0], `?${path.split("?")[1]}`)
    expect(parsed.selection).toEqual(collection)
    expect(parsed.tab).toBeUndefined()
    expect(parsed.docs?.filter).toBe('{"a":1}')
    expect(parsed.docs?.limit).toBe(25)
    expect(parsed.docs?.skip).toBe(5)
    expect(parsed.docs?.pinned).toEqual([])
    expect(parsed.docs?.chart?.filter).toBe('{"region":"EMEA"}')
  })

  it("handles legacy chart URLs and invalid tabs", () => {
    const parsed = parseLocation(
      "/connections/c1/databases/d1/collections/c2",
      `?tab=chart&chart=${encodeChartParam(chart)}`,
    )
    expect(parsed.tab).toBe("chart")
    expect(parsed.docs?.chart?.config.type).toBe("line")
    expect(parseLocation("/connections/c1", "?tab=nope").tab).toBeUndefined()
    expect(parseLocation("/", "").selection.kind).toBe("welcome")
    expect(parseLocation("/dashboard", "").selection.kind).toBe("dashboard")
  })
})

describe("chart URL encoding", () => {
  it("round-trips and rejects malformed values", () => {
    expect(decodeChartParam(encodeChartParam(chart))).toEqual(chart)
    expect(decodeChartParam(null)).toBeUndefined()
    expect(decodeChartParam("not-base64!!")).toBeUndefined()
  })
})

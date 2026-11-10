import { describe, expect, it } from "vitest"

import {
  buildChartData,
  buildChartPipeline,
  chartDataFromRows,
  DEFAULT_CHART_CONFIG,
  formatAxisValue,
  formatChartValue,
  formatXAxisLabel,
  withLiveWindow,
  normalizeChartConfig,
  resolveTimeBucket,
  timeBucketEnd,
  timeBucketStart,
  type ChartConfig,
} from "@/lib/chart"
import type { MongoDocument } from "@/lib/types"

function config(patch: Partial<ChartConfig>): ChartConfig {
  return { ...DEFAULT_CHART_CONFIG, ...patch }
}

const users: MongoDocument[] = [
  { status: "active", region: "eu", amount: 10, createdAt: { $date: "2024-01-01T10:00:00Z" } },
  { status: "active", region: "us", amount: 20, createdAt: { $date: "2024-01-01T12:00:00Z" } },
  { status: "failed", region: "eu", amount: 5, createdAt: { $date: "2024-01-02T09:00:00Z" } },
  { status: "failed", region: "us", amount: 7, createdAt: { $date: "2024-01-03T09:00:00Z" } },
]

describe("buildChartData", () => {
  it("counts per category", () => {
    const data = buildChartData(users, config({ x: "status", aggregate: "count" }))
    expect(data.categories).toEqual(["active", "failed"])
    expect(data.series).toEqual([{ name: "count", values: [2, 2] }])
  })

  it("sums numeric values", () => {
    const data = buildChartData(
      users,
      config({ x: "status", y: ["amount"], aggregate: "sum" }),
    )
    expect(data.series[0].values).toEqual([30, 12])
  })

  it("splits series by group", () => {
    const data = buildChartData(
      users,
      config({ x: "status", group: "region", aggregate: "count" }),
    )
    expect(data.categories).toEqual(["active", "failed"])
    expect(data.series.map((series) => series.name).sort()).toEqual(["eu", "us"])
    const eu = data.series.find((series) => series.name === "eu")
    expect(eu?.values).toEqual([1, 1])
  })

  it("buckets dates by day in UTC", () => {
    const data = buildChartData(
      users,
      config({ x: "createdAt", aggregate: "count", timeBucket: "day", timeZone: "utc" }),
    )
    expect(data.categories).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"])
    expect(data.series[0].values).toEqual([2, 1, 1])
    expect(data.ranges?.[0]).toEqual({
      start: "2024-01-01T00:00:00.000Z",
      end: "2024-01-02T00:00:00.000Z",
    })
  })

  it("merges the tail into Other", () => {
    const data = buildChartData(
      users,
      config({ x: "status", aggregate: "count", limit: 1, others: true }),
      "Other",
    )
    expect(data.categories).toEqual(["active", "Other"])
    expect(data.series[0].values).toEqual([2, 2])
  })

  it("keeps only the raw points requested", () => {
    const data = buildChartData(
      users,
      config({ x: "status", y: ["amount"], aggregate: "none", limit: 2 }),
    )
    expect(data.categories).toEqual(["active", "active"])
    expect(data.series[0].values).toEqual([10, 20])
  })
})

describe("downsampleChartData", () => {
  it("keeps endpoints and the requested size", async () => {
    const { downsampleChartData } = await import("@/lib/chart")
    const docs = Array.from({ length: 200 }, (_, index) => ({
      status: `s${index}`,
      amount: index,
    }))
    const data = buildChartData(
      docs,
      config({ x: "status", y: ["amount"], aggregate: "sum", limit: 500, others: false }),
    )
    const sampled = downsampleChartData(data, 20)
    expect(sampled.categories).toHaveLength(20)
    expect(sampled.categories[0]).toBe("s0")
    expect(sampled.categories[sampled.categories.length - 1]).toBe("s199")
    expect(sampled.series[0].values).toHaveLength(20)
  })
})

describe("chartDataFromRows", () => {
  it("maps grouped aggregation rows", () => {
    const data = chartDataFromRows(
      [
        { _id: { x: "active", g: "eu" }, v0: 2 },
        { _id: { x: "active", g: "us" }, v0: 1 },
        { _id: { x: "failed", g: "eu" }, v0: 4 },
      ],
      config({ x: "status", group: "region", aggregate: "sum", y: ["amount"] }),
    )
    expect(data.categories).toEqual(["active", "failed"])
    expect(data.series.find((series) => series.name === "eu")?.values).toEqual([2, 4])
  })

  it("maps multiple value fields", () => {
    const data = chartDataFromRows(
      [{ _id: { x: "a" }, v0: 1, v1: 2 }],
      config({ x: "status", aggregate: "sum", y: ["amount", "other"] }),
    )
    expect(data.series).toEqual([
      { name: "amount", values: [1] },
      { name: "other", values: [2] },
    ])
  })
})

describe("buildChartPipeline", () => {
  it("groups by category and sums values", () => {
    const pipeline = buildChartPipeline(
      config({ x: "status", aggregate: "sum", y: ["amount"] }),
      { status: "active" },
      false,
    ) as Record<string, unknown>[]
    expect(pipeline[0]).toEqual({ $match: { status: "active" } })
    const group = pipeline[1].$group as Record<string, unknown>
    expect(group._id).toEqual({ x: "$status", g: null })
    expect(group.v0).toEqual({ $sum: "$amount" })
  })

  it("converts string dates and applies the time zone", () => {
    const pipeline = buildChartPipeline(
      config({ x: "createdAt", aggregate: "count", timeBucket: "month", timeZone: "utc" }),
      {},
      true,
    ) as Record<string, unknown>[]
    const group = pipeline[0].$group as Record<string, any>
    expect(group._id.x.$dateTrunc.unit).toBe("month")
    expect(group._id.x.$dateTrunc.timezone).toBe("UTC")
    expect(group._id.x.$dateTrunc.date.$convert.to).toBe("date")
  })
})

describe("time buckets", () => {
  it("uses Monday as the week start", () => {
    const start = timeBucketStart(new Date("2024-01-03T12:00:00Z"), "week", "utc")
    expect(start.toISOString()).toBe("2024-01-01T00:00:00.000Z")
    expect(timeBucketEnd(start, "week", "utc").toISOString()).toBe(
      "2024-01-08T00:00:00.000Z",
    )
  })

  it("resolves auto buckets from the time span", () => {
    const docs = [
      { at: { $date: "2020-01-01T00:00:00Z" } },
      { at: { $date: "2024-01-01T00:00:00Z" } },
    ]
    expect(resolveTimeBucket(docs, "at", "auto")).toBe("year")
  })
})

describe("formatting and config", () => {
  it("formats percent and currency values", () => {
    expect(formatChartValue(0.256, config({ numberFormat: "percent", decimals: 1 }))).toBe(
      "25.6%",
    )
    expect(formatChartValue(12.3, config({ numberFormat: "currency", unit: "$", decimals: 2 }))).toBe(
      "$12.30",
    )
    expect(formatChartValue(12_500, config({ yAxisScale: "k", decimals: 1 }))).toBe("12.5k")
    expect(formatChartValue(2_500_000, config({ yAxisScale: "m", unit: "req" }))).toBe("2.5M req")
    expect(formatChartValue(1536, config({ yAxisScale: "bytes" }))).toBe("1.5 KB")
  })

  it("normalises stale or tampered configs", () => {
    const normalized = normalizeChartConfig({ type: "nope", limit: -5, timeBucket: "x" })
    expect(normalized.type).toBe("bar")
    expect(normalized.limit).toBe(20)
    expect(normalized.timeBucket).toBe("none")
    expect(normalized.timeZone).toBe("utc")
    expect(normalized.yAxisScale).toBe("none")
  })

  it("formats axis ticks with the conversion and unit", () => {
    expect(formatAxisValue(12_500, config({ yAxisScale: "k", unit: "req" }))).toBe("12.5k req")
    expect(formatAxisValue(2_000_000, config({ yAxisScale: "m", decimals: 0 }))).toBe("2M")
  })

  it("adds a moving live window", () => {
    const now = Date.parse("2024-01-01T12:00:00Z")
    expect(withLiveWindow({ status: "a" }, "createdAt", 5, now)).toEqual({
      $and: [
        { status: "a" },
        {
          createdAt: {
            $gte: { $date: "2024-01-01T11:55:00.000Z" },
          },
        },
      ],
    })
    expect(withLiveWindow({}, "createdAt", 0, now)).toEqual({})
  })

  it("formats X-axis labels as dates and numbers", () => {
    expect(
      formatXAxisLabel({ $date: "2024-01-02T10:00:00Z" }, "2024-01-02", "date", "en", "utc"),
    ).toBe("01/02/2024")
    expect(formatXAxisLabel(12_500, "12500", "compact", "en", "utc")).toBe("12.5k")
    expect(formatXAxisLabel("plain", "plain", "date", "en", "utc")).toBe("plain")
  })
})

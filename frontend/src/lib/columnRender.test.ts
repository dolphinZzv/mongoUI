import { describe, expect, it } from "vitest"

import { durationMilliseconds, formatDurationValue } from "@/lib/columnRender"

describe("formatDurationValue", () => {
  it("formats millisecond numbers", () => {
    expect(formatDurationValue(0)).toBe("0 ms")
    expect(formatDurationValue(12.4)).toBe("12 ms")
    expect(formatDurationValue(1500)).toBe("1.50 s")
    expect(formatDurationValue(90_000)).toBe("1.5 min")
    expect(formatDurationValue(3_600_000)).toBe("1.0 h")
  })

  it("accepts numeric strings and BSON numerics", () => {
    expect(formatDurationValue("250")).toBe("250 ms")
    expect(formatDurationValue({ $numberLong: "1500" })).toBe("1.50 s")
    expect(formatDurationValue({ $numberDecimal: "60000" })).toBe("1.0 min")
  })

  it("keeps negative durations readable and rejects non-numbers", () => {
    expect(formatDurationValue(-1500)).toBe("-1.50 s")
    expect(durationMilliseconds("abc")).toBeNull()
    expect(formatDurationValue(null)).toBeNull()
    expect(formatDurationValue(true)).toBeNull()
  })
})

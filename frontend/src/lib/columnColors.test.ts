import { describe, expect, it } from "vitest"

import {
  colorWithAlpha,
  columnColorRule,
  columnColorStyle,
} from "@/lib/columnColors"
import type { ColumnColorRule, ColumnColorRules } from "@/lib/columnPrefs"

function rule(patch: Partial<ColumnColorRule>): ColumnColorRule {
  return {
    id: patch.id ?? "rule",
    operator: patch.operator ?? "eq",
    value: patch.value ?? "",
    color: patch.color ?? "#ef4444",
    style: patch.style ?? "text",
  }
}

const rules: ColumnColorRules = {
  status: [rule({ id: "failed", operator: "eq", value: "failed" })],
  amount: [
    rule({ id: "high", operator: "gte", value: "100", color: "#f59e0b" }),
    rule({ id: "low", operator: "lt", value: "50", color: "#0ea5e9" }),
  ],
}

describe("columnColorRule", () => {
  it("matches strings case-insensitively", () => {
    expect(columnColorRule(rules, "status", "FAILED")?.id).toBe("failed")
    expect(columnColorRule(rules, "status", "active")).toBeNull()
  })

  it("compares BSON numbers numerically", () => {
    expect(columnColorRule(rules, "amount", { $numberInt: "150" })?.id).toBe("high")
    expect(columnColorRule(rules, "amount", { $numberDecimal: "49.5" })?.id).toBe("low")
    expect(columnColorRule(rules, "amount", "75")).toBeNull()
  })

  it("supports empty and not-empty rules", () => {
    const emptyRules: ColumnColorRules = {
      note: [
        rule({ id: "empty", operator: "empty" }),
        rule({ id: "filled", operator: "notEmpty", color: "#10b981" }),
      ],
    }
    expect(columnColorRule(emptyRules, "note", null)?.id).toBe("empty")
    expect(columnColorRule(emptyRules, "note", "")?.id).toBe("empty")
    expect(columnColorRule(emptyRules, "note", "hello")?.id).toBe("filled")
  })

  it("uses the first matching rule", () => {
    const overlapping: ColumnColorRules = {
      amount: [
        rule({ id: "first", operator: "gte", value: "100" }),
        rule({ id: "second", operator: "gte", value: "0" }),
      ],
    }
    expect(columnColorRule(overlapping, "amount", 150)?.id).toBe("first")
  })
})

describe("columnColorStyle", () => {
  it("builds soft background fills from hex colors", () => {
    expect(colorWithAlpha("#ef4444", 0.16)).toBe("rgba(239, 68, 68, 0.16)")
    expect(colorWithAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)")
    expect(colorWithAlpha("var(--primary)", 0.5)).toBe("var(--primary)")
  })

  it("only applies the requested target", () => {
    expect(columnColorStyle(rule({ style: "text" }), "text")).toEqual({ color: "#ef4444" })
    expect(columnColorStyle(rule({ style: "text" }), "background")).toBeUndefined()
    expect(columnColorStyle(rule({ style: "background" }), "background")).toEqual({
      backgroundColor: "rgba(239, 68, 68, 0.16)",
      boxShadow: "inset 2px 0 0 #ef4444",
    })
  })
})

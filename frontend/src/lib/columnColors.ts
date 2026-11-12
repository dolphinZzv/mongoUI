import { formatValue, isPlainObject } from "@/lib/mongo"
import type {
  ColumnColorRule,
  ColumnColorRules,
} from "@/lib/columnPrefs"

/** Convert a #rgb / #rrggbb color to an rgba() string for soft cell fills. */
export function colorWithAlpha(color: string, alpha: number): string {
  const value = color.trim()
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (!match) return value
  const hex =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((char) => char + char)
          .join("")
      : match[1]
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  const safeAlpha = Math.max(0, Math.min(1, alpha))
  return `rgba(${red}, ${green}, ${blue}, ${safeAlpha})`
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (isPlainObject(value)) {
    const raw =
      value.$numberLong ?? value.$numberInt ?? value.$numberDouble ?? value.$numberDecimal
    if (raw !== undefined) {
      const parsed = Number(raw)
      return Number.isFinite(parsed) ? parsed : null
    }
  }
  return null
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim() === ""
  return Array.isArray(value) && value.length === 0
}

/** First matching rule for a column cell, or null. */
export function columnColorRule(
  rules: ColumnColorRules | undefined,
  column: string,
  value: unknown,
): ColumnColorRule | null {
  const list = rules?.[column]
  if (!list || list.length === 0) return null

  const text = formatValue(value)
  const normalizedText = text.trim().toLowerCase()
  const cellNumber = numericValue(value)
  const empty = isEmpty(value)

  for (const rule of list) {
    const target = rule.value.trim()
    switch (rule.operator) {
      case "empty":
        if (empty) return rule
        break
      case "notEmpty":
        if (!empty) return rule
        break
      case "eq": {
        const ruleNumber = numericValue(target)
        if (cellNumber !== null && ruleNumber !== null) {
          if (cellNumber === ruleNumber) return rule
        } else if (normalizedText === target.toLowerCase()) {
          return rule
        }
        break
      }
      case "neq": {
        const ruleNumber = numericValue(target)
        const equal =
          cellNumber !== null && ruleNumber !== null
            ? cellNumber === ruleNumber
            : normalizedText === target.toLowerCase()
        if (!equal) return rule
        break
      }
      case "contains":
        if (normalizedText.includes(target.toLowerCase())) return rule
        break
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const ruleNumber = numericValue(target)
        if (cellNumber === null || ruleNumber === null) break
        if (rule.operator === "gt" && cellNumber > ruleNumber) return rule
        if (rule.operator === "gte" && cellNumber >= ruleNumber) return rule
        if (rule.operator === "lt" && cellNumber < ruleNumber) return rule
        if (rule.operator === "lte" && cellNumber <= ruleNumber) return rule
        break
      }
    }
  }
  return null
}

/** Inline styling for a matched rule. Background fills belong on the cell. */
export function columnColorStyle(rule: ColumnColorRule | null, target: "text" | "background") {
  if (!rule || rule.style !== target) return undefined
  return target === "text"
    ? { color: rule.color }
    : { backgroundColor: colorWithAlpha(rule.color, 0.16), boxShadow: `inset 2px 0 0 ${rule.color}` }
}

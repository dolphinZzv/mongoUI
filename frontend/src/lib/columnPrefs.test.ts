import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { readColumnPrefs, reorderVisibleColumns } from "@/lib/columnPrefs"

const visible = ["_id", "name", "amount", "createdAt"]
const all = [...visible, "hidden"]
const pinned = ["_id"]

describe("reorderVisibleColumns", () => {
  it("moves a column before another in the same group", () => {
    expect(
      reorderVisibleColumns([], visible, all, pinned, "createdAt", "name", "before"),
    ).toEqual(["_id", "createdAt", "name", "amount", "hidden"])
  })

  it("moves a column after another in the same group", () => {
    expect(
      reorderVisibleColumns([], visible, all, pinned, "name", "createdAt", "after"),
    ).toEqual(["_id", "amount", "createdAt", "name", "hidden"])
  })

  it("keeps pinned columns first and ignored cross-group drops", () => {
    const order = ["_id", "name", "amount", "createdAt"]
    expect(reorderVisibleColumns(order, visible, all, pinned, "name", "_id", "after")).toBe(
      order,
    )
    expect(reorderVisibleColumns(order, visible, all, pinned, "_id", "name", "before")).toBe(
      order,
    )
  })

  it("preserves hidden columns after the visible order", () => {
    expect(
      reorderVisibleColumns(
        ["_id", "name", "amount", "createdAt", "hidden"],
        visible,
        all,
        pinned,
        "amount",
        "name",
        "before",
      ),
    ).toEqual(["_id", "amount", "name", "createdAt", "hidden"])
  })
})

describe("readColumnPrefs color rules", () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = new Map()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("normalizes valid rules and drops invalid ones", () => {
    store.set(
      "prefs",
      JSON.stringify({
        colors: {
          status: [
            { id: "a", operator: "eq", value: "failed", color: "#F00", style: "background" },
            { id: "a", operator: "bogus", value: "x", color: "red" },
            { operator: "contains", value: "ok", color: "#10b981" },
          ],
        },
      }),
    )
    expect(readColumnPrefs("prefs").colors.status).toEqual([
      {
        id: "a",
        operator: "eq",
        value: "failed",
        color: "#ff0000",
        style: "background",
      },
      {
        id: "status-2",
        operator: "contains",
        value: "ok",
        color: "#10b981",
        style: "text",
      },
    ])
  })
})

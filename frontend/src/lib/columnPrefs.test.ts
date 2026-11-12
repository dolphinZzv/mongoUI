import { describe, expect, it } from "vitest"

import { reorderVisibleColumns } from "@/lib/columnPrefs"

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

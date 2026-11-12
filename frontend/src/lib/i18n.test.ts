import { describe, expect, it } from "vitest"

import en from "@/lib/i18n/en"
import zh from "@/lib/i18n/zh"

describe("i18n dictionaries", () => {
  it("keeps English and Chinese keys in sync", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})

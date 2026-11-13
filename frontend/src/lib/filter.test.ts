import { describe, expect, it } from "vitest"

import { compileTextFilter } from "@/lib/filter"

describe("compileTextFilter", () => {
  it("matches everything for an empty query", () => {
    expect(compileTextFilter("  ")("anything")).toBe(true)
  })

  it("does a case-insensitive substring match by default", () => {
    const match = compileTextFilter("USERS")
    expect(match("all_users")).toBe(true)
    expect(match("orders")).toBe(false)
  })

  it("supports globs and escaped wildcards", () => {
    expect(compileTextFilter("user*")("users_archive")).toBe(true)
    expect(compileTextFilter("user?")("users")).toBe(true)
    expect(compileTextFilter("a\\*b")("a*b")).toBe(true)
    expect(compileTextFilter("a\\*b")("axb")).toBe(false)
  })

  it("supports /regex/flags and resets global state", () => {
    const match = compileTextFilter("/^user$/i")
    expect(match("USER")).toBe(true)
    expect(match("users")).toBe(false)
    const global = compileTextFilter("/a/g")
    expect(global("a")).toBe(true)
    expect(global("a")).toBe(true)
  })

  it("falls back to plain text for invalid regexes", () => {
    expect(compileTextFilter("/[/")("/[/")).toBe(true)
    expect(compileTextFilter("/abc/z")("/abc/z")).toBe(true)
  })
})

import { expect, test } from "@playwright/test"

import { collectionPath, readState } from "./state"

const state = readState()
const path = `${collectionPath(state)}?tab=chart`

test.beforeEach(async ({ page }) => {
  await page.goto(path)
  await page.getByRole("button", { name: /Configure/i }).waitFor()
  await page.locator('svg[role="img"]').waitFor()
})

test("legacy chart URL opens the chart dialog on Documents", async ({ page }) => {
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("tab", { name: "Documents" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(page.getByRole("tab", { name: "Chart" })).toHaveCount(0)
})

test("defaults to a line chart", async ({ page }) => {
  const config = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith("mongoui-chart:docs:"))
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null
  })
  expect(config?.type).toBe("line")
  await expect.poll(() => page.locator('svg[role="img"] path').count()).toBeGreaterThan(0)
})

test("searches and multi-selects Y-axis fields", async ({ page }) => {
  await page.getByRole("button", { name: /Configure/i }).click()
  const yButton = page
    .locator("label", { hasText: "Y axis (numeric)" })
    .locator("xpath=following-sibling::button")
  const before = (await yButton.getAttribute("title")) ?? ""

  await yButton.click()
  const search = page.getByPlaceholder("Search fields")
  await expect(search).toBeVisible()
  await search.fill("latency")
  await expect(page.getByRole("option")).toHaveCount(1)
  await page.getByRole("option", { name: /latencyMs/i }).click()
  await expect.poll(() => yButton.getAttribute("title")).toContain("latencyMs")

  await expect.poll(() => yButton.getAttribute("title")).not.toBe(before)

  await search.fill("latency")
  await page.getByRole("option", { name: /latencyMs/i }).click()
  await expect.poll(() => yButton.getAttribute("title")).not.toContain("latencyMs")
  await expect.poll(() => yButton.getAttribute("title")).toBe(before)
})

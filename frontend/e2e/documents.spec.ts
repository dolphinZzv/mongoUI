import { expect, test, type Page } from "@playwright/test"

import { collectionPath, readState } from "./state"

const state = readState()
const path = collectionPath(state)

async function headers(page: Page): Promise<string[]> {
  return page.locator("th[data-column]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-column") ?? ""),
  )
}

async function columnPrefs(page: Page): Promise<{ order?: string[]; colors?: Record<string, unknown[]> } | null> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith("mongoui-columns:"))
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto(path)
  await page.locator('th[data-column="amount"]').waitFor()
  await page.locator("tbody tr[data-row-index]").first().waitFor()
})

test("reorders columns by dragging a header and persists the order", async ({ page }) => {
  const before = await headers(page)
  expect(before.indexOf("orderNo")).toBeLessThan(before.indexOf("amount"))

  await page
    .locator('th[data-column="amount"]')
    .dragTo(page.locator('th[data-column="orderNo"]'), {
      targetPosition: { x: 4, y: 12 },
    })
  await expect
    .poll(async () => {
      const prefs = await columnPrefs(page)
      if (!prefs?.order) return false
      return prefs.order.indexOf("amount") < prefs.order.indexOf("orderNo")
    })
    .toBe(true)

  await page.reload()
  await page.locator('th[data-column="amount"]').waitFor()
  const reloaded = await headers(page)
  expect(reloaded.indexOf("amount")).toBeLessThan(reloaded.indexOf("orderNo"))
})

test("keeps draft filter text local until Run", async ({ page }) => {
  let findRequests = 0
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/find")) findRequests += 1
  })

  const editor = page.getByTestId("mongo-filter-editor")
  await editor.fill('{"region":"EMEA"}')
  await page.waitForTimeout(400)
  expect(findRequests).toBe(0)

  const response = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().endsWith("/find"),
  )
  await page.getByTestId("documents-run").click()
  const body = (await (await response).json()) as { data: { total?: number } }
  expect(body.data.total).toBe(20)

  await expect
    .poll(() =>
      page
        .locator('tbody td[data-column="region"]')
        .evaluateAll((cells) => cells.map((cell) => cell.textContent?.trim())),
    )
    .toEqual(Array.from({ length: 20 }, () => "EMEA"))
})

test("paginates with _id cursors and does not recount every page", async ({ page }) => {
  await expect(page.locator("tbody tr[data-row-index]")).toHaveCount(50)

  const nextRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/find"),
  )
  await page.getByRole("button", { name: /Next page/i }).click()
  const nextBody = (await nextRequest).postDataJSON() as {
    includeTotal?: boolean
    after?: unknown
  }
  expect(nextBody.includeTotal).toBe(false)
  expect(nextBody.after).toBeTruthy()
  await expect(page.locator("tbody tr[data-row-index]")).toHaveCount(10)

  const prevRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/find"),
  )
  await page.getByRole("button", { name: /Previous page/i }).click()
  const prevBody = (await prevRequest).postDataJSON() as {
    includeTotal?: boolean
    before?: unknown
  }
  expect(prevBody.includeTotal).toBe(false)
  expect(prevBody.before).toBeTruthy()
  await expect(page.locator("tbody tr[data-row-index]")).toHaveCount(50)
})

test("inserts a document through the dialog", async ({ page }) => {
  await page.goto(collectionPath(state, state.crudCollection))
  const rows = page.locator("tbody tr[data-row-index]")
  await expect(rows).toHaveCount(1)

  await page.getByRole("button", { name: /Insert/i }).click()
  const dialog = page.getByRole("dialog")
  await dialog.locator("textarea").fill(
    JSON.stringify({ name: "e2e-insert", orderNo: 99999, amount: 12, latencyMs: 150, region: "NA" }),
  )
  await dialog.getByRole("button", { name: /Save|Insert/i }).click()
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText("e2e-insert")
})

test("applies and persists conditional column colors", async ({ page }) => {
  const header = page.locator('th[data-column="amount"]')
  await header.hover()
  await header.getByRole("button", { name: "Column actions" }).click()
  await page.getByRole("menuitem", { name: /Conditional colors/i }).click()

  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Conditional colors", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: /Add rule/i }).click()
  await dialog.getByRole("combobox").nth(0).click()
  await page.getByRole("option", { name: "greater than or equal" }).click()
  await dialog.getByPlaceholder("Value to compare").fill("150")
  await dialog.getByRole("combobox").nth(1).click()
  await page.getByRole("option", { name: "Background" }).click()
  await dialog.getByRole("button", { name: "Save" }).click()

  const coloredCells = () =>
    page
      .locator('td[data-column="amount"]')
      .evaluateAll((cells) =>
        cells.filter((cell) => (cell.getAttribute("style") ?? "").includes("background-color"))
          .length,
      )
  await expect.poll(coloredCells).toBeGreaterThan(0)

  await expect
    .poll(async () => (await columnPrefs(page))?.colors?.amount?.length ?? 0)
    .toBeGreaterThan(0)

  await page.reload()
  await page.locator('th[data-column="amount"]').waitFor()
  await page.locator("tbody tr[data-row-index]").first().waitFor()
  await expect.poll(coloredCells).toBeGreaterThan(0)
})

test("restores results when the URL query changes externally", async ({ page }) => {
  await page.getByTestId("mongo-filter-editor").fill('{"region":"EMEA"}')
  await page.getByTestId("documents-run").click()
  await expect
    .poll(() =>
      page
        .locator('tbody td[data-column="region"]')
        .evaluateAll((cells) => cells.every((cell) => cell.textContent?.trim() === "EMEA")),
    )
    .toBe(true)

  await page.evaluate(() => {
    const url = new URL(window.location.href)
    url.searchParams.set("filter", '{"region":"APAC"}')
    window.history.pushState({}, "", url)
    window.dispatchEvent(new PopStateEvent("popstate"))
  })

  await expect
    .poll(() =>
      page
        .locator('tbody td[data-column="region"]')
        .evaluateAll((cells) =>
          cells.length > 0 && cells.every((cell) => cell.textContent?.trim() === "APAC"),
        ),
    )
    .toBe(true)
  await expect(page.getByTestId("mongo-filter-editor")).toHaveValue('{"region":"APAC"}')
})

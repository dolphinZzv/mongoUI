import { expect, test } from "@playwright/test"

import { collectionPath, readState } from "./state"

const state = readState()
const path = collectionPath(state)

test("keeps SQL and aggregation inside one Query tab", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${path}?tab=query`)
  await page.getByRole("tab", { name: "Query" }).waitFor()
  await expect(page.getByRole("tab", { name: "Query" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(page.getByTestId("query-mode-sql")).toHaveAttribute("aria-selected", "true")

  await page.getByTestId("query-mode-aggregation").click()
  await expect(page).toHaveURL(/\?tab=aggregation/)
  await expect(page.getByTestId("query-mode-aggregation")).toHaveAttribute(
    "aria-selected",
    "true",
  )

  await page.getByTestId("query-mode-sql").click()
  await expect(page).toHaveURL(/\?tab=sql/)
  await expect(page.getByTestId("query-mode-sql")).toHaveAttribute("aria-selected", "true")

  // Legacy deep links still open the right mode.
  await page.goto(`${path}?tab=aggregation`)
  await page.getByTestId("query-mode-aggregation").waitFor({ timeout: 30_000 })
  await expect(page.getByTestId("query-mode-aggregation")).toHaveAttribute(
    "aria-selected",
    "true",
  )
})

import { expect, test } from "@playwright/test"

test("renders the cross-connection dashboard", async ({ page }) => {
  await page.goto("/dashboard")
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
  await expect(page.getByText("Pinned charts shared by the team")).toBeVisible()
})

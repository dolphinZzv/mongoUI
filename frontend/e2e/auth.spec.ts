import { expect, test } from "@playwright/test"

import { E2E_PASSWORD, E2E_USERNAME } from "./credentials"

test.use({ storageState: { cookies: [], origins: [] } })

test("logs in with the seeded admin password", async ({ page }) => {
  await page.goto("/")
  await page.locator("#login-username").fill(E2E_USERNAME)
  await page.locator("#login-password").fill(E2E_PASSWORD)
  await page.getByRole("button", { name: /Sign in/i }).click()
  await expect(page.getByText("E2E Local").first()).toBeVisible()
})

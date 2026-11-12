import { readFileSync, rmSync } from "node:fs"

import type { E2EState } from "./state"

export default async function globalTeardown() {
  let state: E2EState
  try {
    state = JSON.parse(
      readFileSync(new URL("./.state.json", import.meta.url), "utf8"),
    ) as E2EState
  } catch {
    return
  }
  await fetch(
    `http://127.0.0.1:18099/api/connections/${state.connectionId}/databases/${encodeURIComponent(
      state.database,
    )}`,
    { method: "DELETE", headers: { Cookie: state.cookie } },
  ).catch(() => undefined)
  rmSync(new URL("./.state.json", import.meta.url), { force: true })
  rmSync(new URL("./.auth.json", import.meta.url), { force: true })
}

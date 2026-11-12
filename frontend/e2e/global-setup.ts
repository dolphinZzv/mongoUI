import { writeFileSync } from "node:fs"

import { E2E_MONGO_URI, E2E_PASSWORD, E2E_USERNAME } from "./credentials"
import type { E2EState } from "./state"

const API = "http://127.0.0.1:18099"
const UI = "http://127.0.0.1:5174"

function sessionCookie(response: Response): string {
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""]
  const header = cookies.find((value) => value.startsWith("mongoui_session="))
  if (!header) throw new Error(`no session cookie in response: ${cookies.join(", ")}`)
  return header.split(";")[0]
}

async function call(
  path: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<{ status: number; body: any; response: Response }> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  if (cookie) headers.set("Cookie", cookie)
  const response = await fetch(`${API}${path}`, { ...init, headers })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  return { status: response.status, body, response }
}

async function expectOK(path: string, init: RequestInit, cookie?: string) {
  const result = await call(path, init, cookie)
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${init.method ?? "GET"} ${path} failed: ${result.status} ${JSON.stringify(result.body)}`)
  }
  return result
}

export default async function globalSetup() {
  const status = await expectOK("/api/auth/status", { method: "GET" })
  let cookie: string
  if (status.body.data?.needsSetup) {
    const setup = await expectOK("/api/auth/setup/password", {
      method: "POST",
      body: JSON.stringify({ username: E2E_USERNAME, password: E2E_PASSWORD }),
    })
    cookie = sessionCookie(setup.response)
  } else {
    const login = await expectOK("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: E2E_USERNAME,
        password: E2E_PASSWORD,
        method: "password",
      }),
    })
    cookie = sessionCookie(login.response)
  }

  const connections = await expectOK("/api/connections", { method: "GET" }, cookie)
  let connection = (connections.body.data as { id: string; uri: string }[]).find(
    (item) => item.uri === E2E_MONGO_URI,
  )
  if (!connection) {
    const created = await expectOK(
      "/api/connections",
      {
        method: "POST",
        body: JSON.stringify({
          name: "E2E Local",
          uri: E2E_MONGO_URI,
          color: "#22c55e",
          readOnly: false,
        }),
      },
      cookie,
    )
    connection = created.body.data
  }
  if (!connection) throw new Error("could not create the E2E connection")
  await expectOK(`/api/connections/${connection.id}/connect`, { method: "POST" }, cookie)

  const database = `mongoui_e2e_${Date.now()}`
  const collection = "orders"
  const crudCollection = "crud_items"
  const docs = Array.from({ length: 60 }, (_, index) => ({
    orderNo: 10_000 + index,
    amount: Math.round((50 + ((index * 37) % 200)) * 100) / 100,
    latencyMs: 100 + ((index * 53) % 400),
    region: ["EMEA", "APAC", "NA"][index % 3],
    createdDate: {
      $date: new Date(Date.UTC(2026, 7, 1 + Math.floor(index / 3), 12)).toISOString(),
    },
  }))
  const base = `/api/connections/${connection.id}/databases/${database}/collections`
  await expectOK(
    `${base}/${collection}/insert`,
    { method: "POST", body: JSON.stringify({ documents: docs }) },
    cookie,
  )
  await expectOK(
    `${base}/${crudCollection}/insert`,
    {
      method: "POST",
      body: JSON.stringify({
        documents: [{ name: "seed", orderNo: 1, amount: 10, latencyMs: 120, region: "EMEA" }],
      }),
    },
    cookie,
  )

  const state: E2EState = {
    connectionId: connection.id,
    database,
    collection,
    crudCollection,
    cookie,
  }
  writeFileSync(new URL("./.state.json", import.meta.url), JSON.stringify(state, null, 2))
  writeFileSync(
    new URL("./.auth.json", import.meta.url),
    JSON.stringify(
      {
        cookies: [
          {
            name: "mongoui_session",
            value: cookie.slice("mongoui_session=".length),
            domain: "127.0.0.1",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: "Strict",
          },
        ],
        origins: [
          {
            origin: UI,
            localStorage: [{ name: "mongoui-lang", value: "en" }],
          },
        ],
      },
      null,
      2,
    ),
  )
}

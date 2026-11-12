# Browser E2E tests

Playwright starts a throwaway backend (`frontend/../backend`, data in
`/tmp/mongoui-e2e-playwright`) and a Vite dev server on port 5174. A fresh
backend data directory is created for every run, then the global setup creates
the admin account, a MongoDB connection and two seeded collections.

Prerequisites:

- Go 1.27+
- MongoDB listening on `127.0.0.1:27017` (override with `MONGOUI_E2E_MONGO_URI`)
- `pnpm install --frozen-lockfile`
- `pnpm exec playwright install chromium`

Run:

```bash
cd frontend
pnpm test:e2e
```

The same suite runs in CI with a MongoDB service container. Locally the Mongo
instance may contain many unrelated databases; the test navigates directly to
the seeded collection, but a very busy shared server can still make the
collection view slow.

import * as React from "react"
import { Loader2, PlugZap, Wifi, WifiOff } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Connection } from "@/lib/types"

interface ConnectionStatusProps {
  connection: Connection
  /** Called after a successful reconnect so the app can refresh its list. */
  onReconnect: () => void
}

type HealthState = "checking" | "online" | "offline"

interface Health {
  state: HealthState
  latency?: number
  version?: string
}

const MAX_AUTO_ATTEMPTS = 3

/**
 * Compact connection health indicator for the top bar. Pings the server every
 * 30s to report latency and MongoDB version, and automatically tries to
 * reconnect with backoff when the connection drops.
 */
export function ConnectionStatus({ connection, onReconnect }: ConnectionStatusProps) {
  const { t } = useI18n()
  const [health, setHealth] = React.useState<Health>({ state: "checking" })
  const [attempt, setAttempt] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)

  const check = React.useCallback(async () => {
    if (!connection.connected) {
      setHealth({ state: "offline" })
      return false
    }
    setHealth((prev) => ({ ...prev, state: "checking" }))
    const started = performance.now()
    try {
      const info = await api.serverInfo(connection.id)
      const latency = Math.round(performance.now() - started)
      const buildInfo = info?.buildInfo as { version?: string } | undefined
      setHealth({ state: "online", latency, version: buildInfo?.version })
      setAttempt(0)
      return true
    } catch {
      setHealth({ state: "offline" })
      return false
    }
  }, [connection.id, connection.connected])

  const reconnect = React.useCallback(async () => {
    setBusy(true)
    try {
      await api.connect(connection.id)
      const ok = await check()
      if (ok) {
        setAttempt(0)
        onReconnect()
      }
      return ok
    } catch {
      setHealth({ state: "offline" })
      return false
    } finally {
      setBusy(false)
    }
  }, [connection.id, check, onReconnect])

  // Initial + periodic health check.
  React.useEffect(() => {
    void check()
    const timer = window.setInterval(() => void check(), 30000)
    return () => window.clearInterval(timer)
  }, [check])

  // Automatic reconnect with exponential backoff when the server goes away.
  React.useEffect(() => {
    if (health.state !== "offline" || attempt >= MAX_AUTO_ATTEMPTS) return
    const delay = 1000 * 2 ** attempt
    const timer = window.setTimeout(() => {
      setAttempt((prev) => prev + 1)
      void reconnect()
    }, delay)
    timerRef.current = timer
    return () => window.clearTimeout(timer)
  }, [health.state, attempt, reconnect])

  React.useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  const reconnecting = busy || (health.state === "offline" && attempt > 0 && attempt < MAX_AUTO_ATTEMPTS)
  const online = health.state === "online"

  const label = reconnecting
    ? t("health.reconnecting")
    : online
      ? t("health.online")
      : health.state === "checking"
        ? t("health.checking")
        : t("health.disconnected")

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => void reconnect()}
          disabled={busy}
          aria-label={t("health.title")}
          className={cn(
            "hidden items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors sm:flex",
            online
              ? "text-muted-foreground hover:text-foreground"
              : "border-destructive/40 text-destructive hover:bg-destructive/10",
          )}
        >
          {reconnecting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : online ? (
            <Wifi className="size-3.5 text-emerald-500" />
          ) : (
            <WifiOff className="size-3.5" />
          )}
          <span className="font-mono tabular-nums">
            {online && health.latency !== undefined
              ? t("health.latency", { ms: health.latency })
              : label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 text-xs">
          <p className="font-medium">{connection.name}</p>
          <p>
            {label}
            {health.version ? ` · ${t("health.version", { version: health.version })}` : ""}
          </p>
          {attempt > 0 && attempt < MAX_AUTO_ATTEMPTS ? (
            <p>{t("health.autoReconnect", { attempt })}</p>
          ) : null}
          {!online && !reconnecting ? (
            <p className="flex items-center gap-1">
              <PlugZap className="size-3" /> {t("health.reconnect")}
            </p>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

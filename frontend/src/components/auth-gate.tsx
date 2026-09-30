import * as React from "react"
import { Loader2, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LanguageToggle } from "@/components/language-toggle"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import type { AuthSetup, AuthStatus } from "@/lib/types"

interface AuthContextValue {
  enabled: boolean
}

const AuthContext = React.createContext<AuthContextValue>({ enabled: false })

/** Whether TOTP is enabled (used to show the sign-out control). */
export function useAuth(): AuthContextValue {
  return React.useContext(AuthContext)
}

/**
 * Gate the app behind optional TOTP auth. On first run it forces setup; once
 * enabled it asks for a code and keeps a signed session cookie.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await api.authStatus())
    } catch {
      // Never lock users out if the status endpoint is unreachable.
      setStatus({ enabled: false, authenticated: true, needsSetup: false })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    const onUnauthorized = () => void refresh()
    window.addEventListener("mongoui-unauthorized", onUnauthorized)
    return () => window.removeEventListener("mongoui-unauthorized", onUnauthorized)
  }, [refresh])

  if (loading) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    )
  }

  if (!status) return null
  if (status.needsSetup) {
    return <SetupScreen onDone={refresh} />
  }
  if (status.enabled && !status.authenticated) {
    return <LoginScreen onDone={refresh} />
  }
  return <AuthContext.Provider value={{ enabled: status.enabled }}>{children}</AuthContext.Provider>
}

function AuthLayout({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-1 flex items-center justify-between">
            <div className="from-primary to-chart-2 flex size-8 items-center justify-center rounded-md bg-gradient-to-br text-sm font-bold text-white">
              M
            </div>
            <LanguageToggle />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

function SetupScreen({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const [setup, setSetup] = React.useState<AuthSetup | null>(null)
  const [code, setCode] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    void (async () => {
      try {
        setSetup(await api.authSetupBegin())
      } catch (err) {
        setError(err instanceof Error ? err.message : t("auth.setupFailed"))
      }
    })()
  }, [t])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await api.authSetupConfirm(code.trim())
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.invalidCode"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t("auth.setupTitle")} description={t("auth.setupIntro")}>
      {setup ? (
        <form onSubmit={submit} className="space-y-4">
          <div className="flex justify-center">
            <img
              src={setup.qr}
              alt="TOTP QR code"
              className="size-48 rounded-lg border bg-white p-2"
            />
          </div>
          <div className="space-y-1">
            <Label>{t("auth.secretLabel")}</Label>
            <code
              data-testid="totp-secret"
              className="bg-muted block rounded px-2 py-1.5 font-mono text-xs break-all"
            >
              {setup.secret}
            </code>
            <p className="text-muted-foreground text-xs">{t("auth.saveSecret")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="totp-code">{t("auth.codeLabel")}</Label>
            <Input
              id="totp-code"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              className="font-mono tracking-[0.3em]"
              autoFocus
            />
          </div>
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            {t("auth.confirm")}
          </Button>
        </form>
      ) : (
        <div className="text-muted-foreground flex justify-center py-8">
          {error ? <p className="text-destructive text-xs">{error}</p> : <Loader2 className="size-5 animate-spin" />}
        </div>
      )}
    </AuthLayout>
  )
}

function LoginScreen({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const [code, setCode] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await api.authLogin(code.trim())
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.invalidCode"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t("auth.loginTitle")} description={t("auth.loginIntro")}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="login-code">{t("auth.codeLabel")}</Label>
          <Input
            id="login-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="font-mono tracking-[0.3em]"
            autoFocus
          />
        </div>
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
          {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          {t("auth.login")}
        </Button>
      </form>
    </AuthLayout>
  )
}

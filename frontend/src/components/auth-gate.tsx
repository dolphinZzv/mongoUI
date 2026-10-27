import * as React from "react"
import { KeyRound, Loader2, LogIn, ShieldCheck } from "lucide-react"

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
import type { AuthSetup, AuthStatus, AuthRole } from "@/lib/types"

interface AuthContextValue {
  enabled: boolean
  username?: string
  role?: AuthRole
  source?: string
  hasPassword?: boolean
  refresh?: () => Promise<void>
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
    return (
      <LoginScreen
        onDone={refresh}
        passwordEnabled={status.passwordEnabled !== false}
        totpEnabled={status.totpEnabled !== false}
      />
    )
  }
  return (
    <AuthContext.Provider
      value={{
        enabled: status.enabled,
        username: status.username,
        role: status.role,
        source: status.source,
        hasPassword: status.hasPassword,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
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
  const [mode, setMode] = React.useState<"password" | "totp">("password")
  const [setup, setSetup] = React.useState<AuthSetup | null>(null)
  const [username, setUsername] = React.useState("admin")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [code, setCode] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    if (mode !== "totp" || setup) return
    let cancelled = false
    setError("")
    void (async () => {
      try {
        const data = await api.authSetupBegin()
        if (!cancelled) setSetup(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("auth.setupFailed"))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mode, setup, t])

  const changeMode = (next: "password" | "totp") => {
    setMode(next)
    setError("")
  }

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setError("")
    if (password.length < 8) {
      setError(t("auth.passwordTooShort"))
      return
    }
    if (password !== confirm) {
      setError(t("auth.passwordMismatch"))
      return
    }
    setBusy(true)
    try {
      await api.authSetupPassword(username.trim() || "admin", password)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.setupFailed"))
    } finally {
      setBusy(false)
    }
  }

  const submitTOTP = async (event: React.FormEvent) => {
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
    <AuthLayout
      title={t("auth.setupTitle")}
      description={mode === "password" ? t("auth.setupIntro") : t("auth.setupTotpIntro")}
    >
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={mode === "password" ? "secondary" : "outline"}
          onClick={() => changeMode("password")}
        >
          <KeyRound /> {t("auth.method.password")}
        </Button>
        <Button
          type="button"
          variant={mode === "totp" ? "secondary" : "outline"}
          onClick={() => changeMode("totp")}
        >
          <ShieldCheck /> {t("auth.method.totp")}
        </Button>
      </div>

      {mode === "password" ? (
        <form onSubmit={submitPassword} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="setup-username">{t("auth.usernameLabel")}</Label>
            <Input
              id="setup-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="setup-password">{t("auth.passwordLabel")}</Label>
            <Input
              id="setup-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder={t("auth.passwordHint")}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="setup-password-confirm">{t("auth.passwordConfirmLabel")}</Label>
            <Input
              id="setup-password-confirm"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !username.trim() || password.length < 8 || !confirm}
          >
            {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {t("auth.createAccount")}
          </Button>
        </form>
      ) : setup ? (
        <form onSubmit={submitTOTP} className="space-y-4">
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
          {error ? (
            <p className="text-destructive text-xs">{error}</p>
          ) : (
            <Loader2 className="size-5 animate-spin" />
          )}
        </div>
      )}
    </AuthLayout>
  )
}

function LoginScreen({
  onDone,
  passwordEnabled,
  totpEnabled,
}: {
  onDone: () => void
  passwordEnabled: boolean
  totpEnabled: boolean
}) {
  const { t } = useI18n()
  const [mode, setMode] = React.useState<"password" | "code">(
    passwordEnabled ? "password" : "code",
  )
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [code, setCode] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [oidc, setOidc] = React.useState<{ enabled: boolean; buttonLabel?: string } | null>(null)
  const [oidcError] = React.useState(() => {
    if (typeof window === "undefined") return ""
    const params = new URLSearchParams(window.location.search)
    const value = params.get("oidc_error") ?? ""
    if (value) {
      params.delete("oidc_error")
      const query = params.toString()
      window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""))
    }
    return value
  })

  React.useEffect(() => {
    void api.authOIDCConfig().then(setOidc).catch(() => setOidc(null))
  }, [])

  const localEnabled = passwordEnabled || totpEnabled

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      if (mode === "password") {
        await api.authLoginPassword(username.trim(), password)
      } else {
        await api.authLogin(username.trim(), code.trim())
      }
      onDone()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === "password"
            ? t("auth.invalidPassword")
            : t("auth.invalidCode"),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={t("auth.loginTitle")}
      description={
        !localEnabled
          ? t("auth.loginSsoOnly")
          : mode === "password"
            ? t("auth.loginIntroPassword")
            : t("auth.loginIntro")
      }
    >
      <div className="space-y-4">
        {oidcError ? (
          <p className="text-destructive text-xs">{t("auth.ssoError", { error: oidcError })}</p>
        ) : null}
        {oidc?.enabled ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                window.location.href = "/api/auth/oidc/login"
              }}
            >
              <LogIn /> {t("auth.ssoLogin", { label: oidc.buttonLabel || t("auth.sso") })}
            </Button>
            {localEnabled ? (
              <div className="relative py-1 text-center">
                <span className="bg-card text-muted-foreground relative z-10 px-2 text-xs">
                  {t("auth.or")}
                </span>
                <span className="bg-border absolute inset-x-0 top-1/2 h-px" />
              </div>
            ) : null}
          </>
        ) : null}

        {localEnabled ? (
          <form onSubmit={submit} className="space-y-4">
            {passwordEnabled && totpEnabled ? (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={mode === "password" ? "secondary" : "outline"}
                  onClick={() => {
                    setMode("password")
                    setError("")
                  }}
                >
                  <KeyRound /> {t("auth.method.password")}
                </Button>
                <Button
                  type="button"
                  variant={mode === "code" ? "secondary" : "outline"}
                  onClick={() => {
                    setMode("code")
                    setError("")
                  }}
                >
                  <ShieldCheck /> {t("auth.method.totp")}
                </Button>
              </div>
            ) : null}

            <div className="space-y-1">
              <Label htmlFor="login-username">{t("auth.usernameLabel")}</Label>
              <Input
                id="login-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>

            {mode === "password" ? (
              <div className="space-y-1">
                <Label htmlFor="login-password">{t("auth.passwordLabel")}</Label>
                <Input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="login-code">{t("auth.codeLabel")}</Label>
                <Input
                  id="login-code"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="font-mono tracking-[0.3em]"
                />
              </div>
            )}

            {error ? <p className="text-destructive text-xs">{error}</p> : null}
            <Button
              type="submit"
              className="w-full"
              disabled={
                busy ||
                !username.trim() ||
                (mode === "password" ? password.length === 0 : code.length !== 6)
              }
            >
              {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              {t("auth.login")}
            </Button>
          </form>
        ) : null}
      </div>
    </AuthLayout>
  )
}

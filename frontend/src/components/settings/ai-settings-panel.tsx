import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Panel } from "@/components/settings/panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import type {
  AIProvider,
  AISettings,
  AISettingsInput,
  OpenAIAPIMode,
} from "@/lib/types"

interface AIFormState {
  provider: AIProvider | ""
  baseURL: string
  model: string
  apiMode: OpenAIAPIMode | ""
  adkEndpoint: string
  adkAppName: string
  adkUserID: string
}

const EMPTY_FORM: AIFormState = {
  provider: "",
  baseURL: "",
  model: "",
  apiMode: "",
  adkEndpoint: "",
  adkAppName: "",
  adkUserID: "",
}

function formFromSettings(settings: AISettings): AIFormState {
  return {
    provider: settings.provider,
    baseURL: settings.baseURL,
    model: settings.model,
    apiMode: settings.apiMode || (settings.provider === "openai" ? "chat" : ""),
    adkEndpoint: settings.adkEndpoint,
    adkAppName: settings.adkAppName,
    adkUserID: settings.adkUserID,
  }
}

/**
 * Per-account BYOK configuration. Self-contained: it loads the signed-in
 * account's profile on mount, so the settings dialog only has to render it.
 */
export function AISettingsPanel() {
  const { t } = useI18n()
  const [ai, setAI] = React.useState<AISettings | null>(null)
  const [form, setForm] = React.useState<AIFormState>(EMPTY_FORM)
  const [apiKey, setAPIKey] = React.useState("")
  const [adkToken, setADKToken] = React.useState("")
  const [clearAPIKey, setClearAPIKey] = React.useState(false)
  const [clearADKToken, setClearADKToken] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  const apply = React.useCallback((settings: AISettings) => {
    setAI(settings)
    setForm(formFromSettings(settings))
    setAPIKey("")
    setADKToken("")
    setClearAPIKey(false)
    setClearADKToken(false)
  }, [])

  const refresh = React.useCallback(async () => {
    try {
      apply(await api.getAISettings())
    } catch {
      toast.error(t("ai.loadFailed"))
    }
  }, [apply, t])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const input = (): AISettingsInput => ({
    provider: form.provider,
    baseURL: form.baseURL,
    model: form.model,
    apiMode: form.apiMode,
    apiKey: apiKey.trim() || undefined,
    clearAPIKey,
    adkEndpoint: form.adkEndpoint,
    adkAppName: form.adkAppName,
    adkUserID: form.adkUserID,
    adkToken: adkToken.trim() || undefined,
    clearADKToken,
  })

  const test = async () => {
    if (!form.provider || testing) return
    setTesting(true)
    try {
      const result = await api.testAISettings(input())
      const label = result.model ? `${result.provider} / ${result.model}` : result.provider
      toast.success(t("ai.testOk", { provider: label }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai.testFailed"))
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (!form.provider || saving) return
    setSaving(true)
    try {
      apply(await api.updateAISettings(input()))
      toast.success(t("ai.saved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel title={t("settings.section.ai")} description={t("ai.desc")}>
      {ai === null ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" /> {t("common.loading")}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label>{t("ai.provider")}</Label>
            <Select
              value={form.provider || undefined}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  provider: value as AIProvider,
                  baseURL: "",
                  model: "",
                  apiMode: value === "openai" ? "chat" : "",
                }))
              }
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue placeholder={t("ai.provider")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">{t("ai.provider.openai")}</SelectItem>
                <SelectItem value="gemini">{t("ai.provider.gemini")}</SelectItem>
                <SelectItem value="adk">{t("ai.provider.adk")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.provider === "adk" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="ai-adk-endpoint">{t("ai.adkEndpoint")}</Label>
                <Input
                  id="ai-adk-endpoint"
                  value={form.adkEndpoint}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, adkEndpoint: event.target.value }))
                  }
                  placeholder="http://127.0.0.1:8000"
                  className="font-mono text-xs"
                />
                <p className="text-muted-foreground text-xs">{t("ai.adkEndpointHint")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="ai-adk-app">{t("ai.adkAppName")}</Label>
                  <Input
                    id="ai-adk-app"
                    value={form.adkAppName}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, adkAppName: event.target.value }))
                    }
                    placeholder="mongoui"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ai-adk-user">{t("ai.adkUserID")}</Label>
                  <Input
                    id="ai-adk-user"
                    value={form.adkUserID}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, adkUserID: event.target.value }))
                    }
                    placeholder="mongoui"
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <Label htmlFor="ai-adk-token">{t("ai.adkToken")}</Label>
                  {ai.hasADKToken ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {t("ai.keyStored")}
                    </Badge>
                  ) : null}
                </div>
                <Input
                  id="ai-adk-token"
                  type="password"
                  value={adkToken}
                  onChange={(event) => setADKToken(event.target.value)}
                  placeholder={ai.hasADKToken ? "••••••••" : t("ai.adkToken")}
                  autoComplete="off"
                />
                <p className="text-muted-foreground text-xs">{t("ai.adkTokenHint")}</p>
                {ai.hasADKToken ? (
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={clearADKToken} onCheckedChange={setClearADKToken} />
                    {t("ai.clearToken")}
                  </label>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="ai-base-url">{t("ai.baseURL")}</Label>
                <Input
                  id="ai-base-url"
                  value={form.baseURL}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, baseURL: event.target.value }))
                  }
                  placeholder={
                    form.provider === "gemini"
                      ? "https://generativelanguage.googleapis.com/v1beta"
                      : "https://api.openai.com/v1"
                  }
                  className="font-mono text-xs"
                />
                <p className="text-muted-foreground text-xs">{t("ai.baseURLHint")}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ai-model">{t("ai.model")}</Label>
                <Input
                  id="ai-model"
                  value={form.model}
                  onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                  placeholder={form.provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini"}
                  className="font-mono text-xs"
                />
                <p className="text-muted-foreground text-xs">{t("ai.modelHint")}</p>
              </div>
              {form.provider === "openai" ? (
                <div className="grid gap-1.5">
                  <Label>{t("ai.apiMode")}</Label>
                  <Select
                    value={form.apiMode || "chat"}
                    onValueChange={(value) =>
                      setForm((prev) => ({ ...prev, apiMode: value as OpenAIAPIMode }))
                    }
                  >
                    <SelectTrigger className="w-full sm:w-72">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chat">{t("ai.apiMode.chat")}</SelectItem>
                      <SelectItem value="responses">{t("ai.apiMode.responses")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">{t("ai.apiModeHint")}</p>
                </div>
              ) : null}

              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <Label htmlFor="ai-api-key">{t("ai.apiKey")}</Label>
                  {ai.hasAPIKey ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {t("ai.keyStored")}
                    </Badge>
                  ) : null}
                </div>
                <Input
                  id="ai-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setAPIKey(event.target.value)}
                  placeholder={ai.hasAPIKey ? "••••••••" : "sk-..."}
                  autoComplete="off"
                />
                <p className="text-muted-foreground text-xs">{t("ai.apiKeyHint")}</p>
                {ai.hasAPIKey ? (
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={clearAPIKey} onCheckedChange={setClearAPIKey} />
                    {t("ai.clearKey")}
                  </label>
                ) : null}
              </div>
            </>
          )}

          <p className="text-muted-foreground rounded-lg border p-3 text-xs leading-relaxed">
            {t("ai.note")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void save()} disabled={saving || !form.provider}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {t("ai.save")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void test()}
              disabled={testing || saving || !form.provider}
            >
              {testing ? <Loader2 className="animate-spin" /> : null}
              {testing ? t("ai.testing") : t("ai.test")}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

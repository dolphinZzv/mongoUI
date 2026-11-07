import * as React from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import en from "@/lib/i18n/en"
import zh from "@/lib/i18n/zh"

// The boundary sits above I18nProvider, so it resolves the stored language
// directly from the dictionaries instead of using the hook.
function labels(): (key: string) => string {
  let locale: "en" | "zh" = "en"
  try {
    const stored = localStorage.getItem("mongoui-lang")
    if (stored === "zh" || stored === "en") locale = stored
    else if (/^zh/i.test(navigator.language)) locale = "zh"
  } catch {
    /* storage may be unavailable */
  }
  const dict = locale === "zh" ? zh : en
  return (key) => dict[key] ?? en[key] ?? key
}

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Last-resort guard so a render crash in one screen does not blank the whole
 * app. Users can retry rendering (which resets the boundary) or reload.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the details in the console for bug reports; the UI stays friendly.
    console.error("MongoUI render error:", error, info)
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const t = labels()

    return (
      <div className="bg-background flex h-full min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="bg-destructive/10 text-destructive flex size-12 items-center justify-center rounded-full">
          <AlertTriangle className="size-6" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">{t("error.title")}</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            {error.message || t("error.desc")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" onClick={this.reset}>
            <RefreshCw /> {t("error.retry")}
          </Button>
          <Button onClick={() => window.location.reload()}>{t("error.reload")}</Button>
        </div>
        <details className="text-muted-foreground max-w-lg text-left text-xs">
          <summary className="cursor-pointer">{t("error.details")}</summary>
          <pre className="scrollbar-thin mt-2 max-h-48 overflow-auto rounded-md border p-3 font-mono">
            {error.stack || error.message}
          </pre>
        </details>
      </div>
    )
  }
}

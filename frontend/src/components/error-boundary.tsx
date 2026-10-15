import * as React from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"

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

    return (
      <div className="bg-background flex h-full min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="bg-destructive/10 text-destructive flex size-12 items-center justify-center rounded-full">
          <AlertTriangle className="size-6" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            {error.message || "An unexpected error occurred while rendering this view."}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" onClick={this.reset}>
            <RefreshCw /> Retry
          </Button>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </div>
        <details className="text-muted-foreground max-w-lg text-left text-xs">
          <summary className="cursor-pointer">Technical details</summary>
          <pre className="scrollbar-thin mt-2 max-h-48 overflow-auto rounded-md border p-3 font-mono">
            {error.stack || error.message}
          </pre>
        </details>
      </div>
    )
  }
}

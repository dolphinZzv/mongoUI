import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App"
import { AuthGate } from "@/components/auth-gate"
import { ErrorBoundary } from "@/components/error-boundary"
import { I18nProvider } from "@/lib/i18n"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
)

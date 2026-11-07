import type { ReactNode } from "react"
import { Database, Keyboard, Leaf, Plus, Search, Server, Table2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import type { Connection } from "@/lib/types"

interface WelcomeScreenProps {
  connections: Connection[]
  onOpenConnection: (connection: Connection) => void
  onNewConnection: () => void
  onOpenPalette: () => void
  onOpenShortcuts: () => void
}

/** Landing screen: product blurb, first-run onboarding or recent connections. */
export function WelcomeScreen({
  connections,
  onOpenConnection,
  onNewConnection,
  onOpenPalette,
  onOpenShortcuts,
}: WelcomeScreenProps) {
  const { t } = useI18n()

  return (
    <div className="scrollbar-thin h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col items-center justify-center px-6 py-20 text-center">
        <div className="from-primary to-chart-2 mb-6 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg">
          <Leaf className="size-7 text-white" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">MongoUI</h1>
        <p className="text-muted-foreground mt-3 max-w-xl text-sm">{t("app.tagline")}</p>

        <div className="mt-8 grid w-full gap-3 sm:grid-cols-3">
          <Feature
            icon={<Database className="size-4" />}
            title={t("app.feature.browse")}
            text={t("app.feature.browseText")}
          />
          <Feature
            icon={<Table2 className="size-4" />}
            title={t("app.feature.query")}
            text={t("app.feature.queryText")}
          />
          <Feature
            icon={<Server className="size-4" />}
            title={t("app.feature.admin")}
            text={t("app.feature.adminText")}
          />
        </div>

        {connections.length === 0 ? (
          <div className="bg-card mt-8 w-full rounded-2xl border p-6 text-left shadow-sm">
            <h2 className="text-base font-semibold">{t("onboarding.title")}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t("onboarding.desc")}</p>
            <ol className="mt-5 space-y-4">
              {[
                ["onboarding.step1", "onboarding.step1Desc"],
                ["onboarding.step2", "onboarding.step2Desc"],
                ["onboarding.step3", "onboarding.step3Desc"],
              ].map(([title, description], index) => (
                <li key={title} className="flex gap-3">
                  <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t(title)}</p>
                    <p className="text-muted-foreground text-xs">{t(description)}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button onClick={onNewConnection}>
                <Plus /> {t("app.newConnection")}
              </Button>
              <Button variant="outline" onClick={onOpenShortcuts}>
                <Keyboard /> {t("shortcuts.title")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-8 w-full">
            <p className="text-muted-foreground mb-3 text-xs tracking-wide uppercase">
              {t("app.recent")}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {connections.map((connection) => (
                <Button
                  key={connection.id}
                  variant="outline"
                  onClick={() => onOpenConnection(connection)}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: connection.color || "#10b981" }}
                  />
                  {connection.name}
                </Button>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={onNewConnection}>
                <Plus /> {t("app.newConnection")}
              </Button>
              <Button variant="ghost" size="sm" onClick={onOpenPalette}>
                <Search /> {t("palette.open")}
              </Button>
              <Button variant="ghost" size="sm" onClick={onOpenShortcuts}>
                <Keyboard /> {t("shortcuts.title")}
              </Button>
            </div>
          </div>
        )}

        <p className="text-muted-foreground mt-8 text-xs">{t("app.shortcutHint")}</p>
        <p className="text-muted-foreground mt-2 text-xs">MongoUI v{__APP_VERSION__}</p>
      </div>
    </div>
  )
}

function Feature({
  icon,
  title,
  text,
}: {
  icon: ReactNode
  title: string
  text: string
}) {
  return (
    <div className="bg-card rounded-xl border p-4 text-left">
      <div className="text-primary flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="text-muted-foreground mt-1 text-xs">{text}</p>
    </div>
  )
}

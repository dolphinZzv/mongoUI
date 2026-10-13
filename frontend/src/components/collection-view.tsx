import { CheckIcon, CopyIcon, FolderInput, Table2 } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DocumentsTab } from "@/components/documents-tab"
import { LazyMount, TabFallback } from "@/components/lazy-mount"
import { copyToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import type { DocsQueryState } from "@/lib/router"

// The collection tabs other than Documents are loaded on first open, so the
// initial bundle only carries the documents view.
const SqlTab = React.lazy(() => import("@/components/sql-tab").then((m) => ({ default: m.SqlTab })))
const AggregationTab = React.lazy(() =>
  import("@/components/aggregation-tab").then((m) => ({ default: m.AggregationTab })),
)
const IndexesTab = React.lazy(() =>
  import("@/components/indexes-tab").then((m) => ({ default: m.IndexesTab })),
)
const SchemaTab = React.lazy(() =>
  import("@/components/schema-tab").then((m) => ({ default: m.SchemaTab })),
)
const StatsTab = React.lazy(() =>
  import("@/components/stats-tab").then((m) => ({ default: m.StatsTab })),
)
const CopyCollectionDialog = React.lazy(() =>
  import("@/components/copy-collection-dialog").then((m) => ({ default: m.CopyCollectionDialog })),
)

interface CollectionViewProps {
  connectionId: string
  database: string
  collection: string
  readOnly: boolean
  tab?: string
  docs?: DocsQueryState
  onDocsChange?: (docs: DocsQueryState) => void
  onTabChange?: (tab: string) => void
}

export function CollectionView({
  connectionId,
  database,
  collection,
  readOnly,
  tab,
  docs,
  onDocsChange,
  onTabChange,
}: CollectionViewProps) {
  const [copied, setCopied] = React.useState(false)
  const [copyOpen, setCopyOpen] = React.useState(false)
  const { t } = useI18n()
  const activeTab = tab ?? "documents"

  const copyPath = async () => {
    const ok = await copyToClipboard(`${database}.${collection}`)
    if (!ok) {
      toast.error(t("common.copyFailed"))
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
    toast.success(t("collection.pathCopied"))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        value={activeTab}
        onValueChange={onTabChange}
        className="flex h-full min-h-0 flex-col gap-0"
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Table2 className="text-muted-foreground size-4" />
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-muted-foreground truncate text-sm">{database}</span>
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-medium">{collection}</span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={copyPath} title={t("collection.copyPath")}>
            {copied ? <CheckIcon className="text-emerald-600 dark:text-emerald-400" /> : <CopyIcon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={readOnly}
            onClick={() => setCopyOpen(true)}
            title={t("copy.action")}
          >
            <FolderInput />
          </Button>
          <TabsList className="ml-auto">
            <TabsTrigger value="documents">{t("collection.tab.documents")}</TabsTrigger>
            <TabsTrigger value="sql">{t("collection.tab.sql")}</TabsTrigger>
            <TabsTrigger value="aggregation">{t("collection.tab.aggregation")}</TabsTrigger>
            <TabsTrigger value="indexes">{t("collection.tab.indexes")}</TabsTrigger>
            <TabsTrigger value="schema">{t("collection.tab.schema")}</TabsTrigger>
            <TabsTrigger value="stats">{t("collection.tab.stats")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="documents" className="min-h-0 flex-1">
          <DocumentsTab
            key={`${connectionId}:${database}:${collection}`}
            connectionId={connectionId}
            database={database}
            collection={collection}
            readOnly={readOnly}
            initialDocs={docs}
            onDocsChange={onDocsChange}
          />
        </TabsContent>
        <TabsContent value="sql" className="min-h-0 flex-1">
          <React.Suspense fallback={<TabFallback />}>
            <SqlTab connectionId={connectionId} database={database} collection={collection} />
          </React.Suspense>
        </TabsContent>
        <TabsContent value="aggregation" className="min-h-0 flex-1">
          <React.Suspense fallback={<TabFallback />}>
            <AggregationTab
              connectionId={connectionId}
              database={database}
              collection={collection}
            />
          </React.Suspense>
        </TabsContent>
        <TabsContent value="indexes" className="min-h-0 flex-1">
          <React.Suspense fallback={<TabFallback />}>
            <IndexesTab
              connectionId={connectionId}
              database={database}
              collection={collection}
              readOnly={readOnly}
            />
          </React.Suspense>
        </TabsContent>
        <TabsContent value="schema" className="min-h-0 flex-1">
          <React.Suspense fallback={<TabFallback />}>
            <SchemaTab connectionId={connectionId} database={database} collection={collection} />
          </React.Suspense>
        </TabsContent>
        <TabsContent value="stats" className="min-h-0 flex-1">
          <React.Suspense fallback={<TabFallback />}>
            <StatsTab connectionId={connectionId} database={database} collection={collection} />
          </React.Suspense>
        </TabsContent>
      </Tabs>

      <LazyMount active={copyOpen}>
        <CopyCollectionDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          connectionId={connectionId}
          database={database}
          collection={collection}
          onCopied={() => undefined}
        />
      </LazyMount>
    </div>
  )
}

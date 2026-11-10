import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { CellValueDialog } from "@/components/documents/cell-value-dialog"
import { ColumnDictionaryDialog } from "@/components/documents/column-dictionary-dialog"
import { DocumentDialog } from "@/components/document-dialog"
import { JsonEditor } from "@/components/json-editor"
import { LazyMount } from "@/components/lazy-mount"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n"
import { prettyJSON } from "@/lib/mongo"
import type { ChartConfig } from "@/lib/chart"
import type { ColumnDictionaryEntry } from "@/lib/columnPrefs"
import type { ExplainRequest, MongoDocument } from "@/lib/types"

const ChartDialog = React.lazy(() =>
  import("@/components/chart-dialog").then((m) => ({ default: m.ChartDialog })),
)
const CopyCollectionDialog = React.lazy(() =>
  import("@/components/copy-collection-dialog").then((m) => ({ default: m.CopyCollectionDialog })),
)
const ExplainDialog = React.lazy(() =>
  import("@/components/explain-dialog").then((m) => ({ default: m.ExplainDialog })),
)
const ExportDialog = React.lazy(() =>
  import("@/components/data-transfer-dialog").then((m) => ({ default: m.ExportDialog })),
)
const ImportDialog = React.lazy(() =>
  import("@/components/data-transfer-dialog").then((m) => ({ default: m.ImportDialog })),
)
const MongoQueryBuilder = React.lazy(() =>
  import("@/components/mongo-query-builder").then((m) => ({ default: m.MongoQueryBuilder })),
)

export interface EditingState {
  mode: "insert" | "edit"
  document?: MongoDocument
}

export type DeleteConfirm =
  | { type: "one"; document: MongoDocument }
  | { type: "bulk" }
  | { type: "filter" }

interface DocumentsDialogsProps {
  connectionId: string
  database: string
  collection: string
  filter: string
  sort: string
  projection: string
  onReload: () => void

  valuePreview: { column: string; value: unknown } | null
  onValuePreviewChange: (value: { column: string; value: unknown } | null) => void

  dictionaryColumn: string | null
  dictionaryEntries: ColumnDictionaryEntry[]
  onDictionaryOpenChange: (open: boolean) => void
  onDictionarySave: (entries: ColumnDictionaryEntry[]) => void

  viewOpen: boolean
  onViewOpenChange: (open: boolean) => void
  viewName: string
  onViewNameChange: (name: string) => void
  onSaveView: () => void

  updateOpen: boolean
  onUpdateOpenChange: (open: boolean) => void
  updateValue: string
  onUpdateValueChange: (value: string) => void
  onRunBulkUpdate: () => void
  allMatching: boolean
  total: number
  selectedCount: number

  editing: EditingState | null
  onEditingChange: (value: EditingState | null) => void
  onInsert: (value: unknown) => Promise<void>
  onUpdate: (value: unknown) => Promise<void>

  confirm: DeleteConfirm | null
  onConfirmOpenChange: (open: boolean) => void
  onConfirm: () => void

  transfer: "import" | "export" | null
  onTransferChange: (value: "import" | "export" | null) => void

  explainOpen: boolean
  onExplainOpenChange: (open: boolean) => void
  explainRequest: ExplainRequest | null

  copyOpen: boolean
  onCopyOpenChange: (open: boolean) => void

  chartOpen: boolean
  onChartOpenChange: (open: boolean) => void
  chartConfig?: ChartConfig
  chartFilter: string
  onChartConfigChange: (config: ChartConfig) => void
  onChartFilterChange: (filter: string) => void
  documents: MongoDocument[]
  columns: string[]

  builderOpen: boolean
  onBuilderOpenChange: (open: boolean) => void
  fieldTypes: Record<string, string>
  onApplyBuilder: (filter: string, projection: string) => void
  /** Push the chart's filter back to the documents query. */
  onApplyChartFilter: (filter: string) => void
}

/**
 * The modal suite used by the documents tab. Kept out of the tab component so
 * its query/table logic stays readable; every dialog is lazy-mounted.
 */
export function DocumentsDialogs({
  connectionId,
  database,
  collection,
  filter,
  sort,
  projection,
  onReload,
  valuePreview,
  onValuePreviewChange,
  dictionaryColumn,
  dictionaryEntries,
  onDictionaryOpenChange,
  onDictionarySave,
  viewOpen,
  onViewOpenChange,
  viewName,
  onViewNameChange,
  onSaveView,
  updateOpen,
  onUpdateOpenChange,
  updateValue,
  onUpdateValueChange,
  onRunBulkUpdate,
  allMatching,
  total,
  selectedCount,
  editing,
  onEditingChange,
  onInsert,
  onUpdate,
  confirm,
  onConfirmOpenChange,
  onConfirm,
  transfer,
  onTransferChange,
  explainOpen,
  onExplainOpenChange,
  explainRequest,
  copyOpen,
  onCopyOpenChange,
  chartOpen,
  onChartOpenChange,
  chartConfig,
  chartFilter,
  onChartConfigChange,
  onChartFilterChange,
  documents,
  columns,
  builderOpen,
  onBuilderOpenChange,
  fieldTypes,
  onApplyBuilder,
  onApplyChartFilter,
}: DocumentsDialogsProps) {
  const { t } = useI18n()

  return (
    <>
      <CellValueDialog
        open={valuePreview !== null}
        onOpenChange={(open) => {
          if (!open) onValuePreviewChange(null)
        }}
        column={valuePreview?.column ?? ""}
        value={valuePreview?.value}
      />

      <LazyMount active={dictionaryColumn !== null}>
        <ColumnDictionaryDialog
          open={dictionaryColumn !== null}
          onOpenChange={onDictionaryOpenChange}
          column={dictionaryColumn ?? ""}
          entries={dictionaryEntries}
          onSave={onDictionarySave}
        />
      </LazyMount>

      <Dialog open={viewOpen} onOpenChange={onViewOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("views.saveCurrent")}</DialogTitle>
            <DialogDescription>{t("views.saveDesc")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={viewName}
            onChange={(event) => onViewNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                onSaveView()
              }
            }}
            placeholder={t("views.namePlaceholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onViewOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={onSaveView} disabled={!viewName.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={updateOpen} onOpenChange={onUpdateOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("docs.bulkUpdateTitle")}</DialogTitle>
            <DialogDescription>
              {allMatching
                ? t("docs.bulkUpdateAllDesc", { count: total })
                : t("docs.bulkUpdateDesc", { count: selectedCount })}
            </DialogDescription>
          </DialogHeader>
          <JsonEditor
            value={updateValue}
            onChange={onUpdateValueChange}
            placeholder='{ "$set": { "status": "done" } }'
            className="min-h-[8rem]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onUpdateOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={onRunBulkUpdate}>{t("docs.updateAction")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LazyMount active={editing !== null}>
        <DocumentDialog
          open={editing !== null}
          onOpenChange={(open) => !open && onEditingChange(null)}
          title={editing?.mode === "edit" ? t("docs.editTitle") : t("docs.insertTitle")}
          description={editing?.mode === "edit" ? t("docs.editDesc") : t("docs.insertDesc")}
          initialValue={
            editing?.mode === "edit" && editing.document ? prettyJSON(editing.document) : "{\n  \n}"
          }
          submitLabel={editing?.mode === "edit" ? t("docs.saveChanges") : t("docs.insertAction")}
          onSubmit={editing?.mode === "edit" ? onUpdate : onInsert}
        />
      </LazyMount>

      <LazyMount active={confirm !== null}>
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={onConfirmOpenChange}
          title={
            confirm?.type === "filter"
              ? t("docs.deleteFilter")
              : confirm?.type === "bulk"
                ? t("docs.deleteSelectedMany", { count: selectedCount })
                : t("docs.deleteOne")
          }
          description={t("docs.deleteDesc")}
          confirmLabel={t("common.delete")}
          onConfirm={onConfirm}
        />
      </LazyMount>

      <LazyMount active={transfer === "export"}>
        <ExportDialog
          open={transfer === "export"}
          onOpenChange={(open) => !open && onTransferChange(null)}
          connectionId={connectionId}
          database={database}
          collection={collection}
          filter={filter}
          sort={sort}
          projection={projection}
        />
      </LazyMount>
      <LazyMount active={transfer === "import"}>
        <ImportDialog
          open={transfer === "import"}
          onOpenChange={(open) => !open && onTransferChange(null)}
          connectionId={connectionId}
          database={database}
          collection={collection}
          onImported={() => onReload()}
        />
      </LazyMount>
      <LazyMount active={explainOpen}>
        <ExplainDialog
          open={explainOpen}
          onOpenChange={onExplainOpenChange}
          connectionId={connectionId}
          database={database}
          collection={collection}
          request={explainRequest}
        />
      </LazyMount>
      <LazyMount active={copyOpen}>
        <CopyCollectionDialog
          open={copyOpen}
          onOpenChange={onCopyOpenChange}
          connectionId={connectionId}
          database={database}
          collection={collection}
          filter={filter}
          onCopied={() => undefined}
        />
      </LazyMount>
      <LazyMount active={chartOpen}>
        <ChartDialog
          open={chartOpen}
          onOpenChange={onChartOpenChange}
          documents={documents}
          columns={columns}
          fieldTypes={fieldTypes}
          connectionId={connectionId}
          database={database}
          collection={collection}
          filter={filter}
          storageKey={`docs:${connectionId}:${database}:${collection}`}
          initialConfig={chartConfig}
          initialFilter={chartFilter}
          onConfigChange={onChartConfigChange}
          onFilterChange={onChartFilterChange}
          onApplyFilter={onApplyChartFilter}
        />
      </LazyMount>
      <LazyMount active={builderOpen}>
        <MongoQueryBuilder
          open={builderOpen}
          onOpenChange={onBuilderOpenChange}
          connectionId={connectionId}
          database={database}
          collection={collection}
          fields={columns}
          fieldTypes={fieldTypes}
          value={filter}
          projection={projection}
          onApply={onApplyBuilder}
        />
      </LazyMount>
    </>
  )
}

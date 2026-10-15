import { AlertCircle, ListFilter, Pencil, Plus, RefreshCw, Rows3, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { CellValue } from "./cell"
import { useI18n } from "@/lib/i18n"
import { documentId } from "@/lib/mongo"
import type { MongoDocument } from "@/lib/types"

interface DocumentsCardListProps {
  loading: boolean
  error: string | null
  documents: MongoDocument[]
  columns: string[]
  selected: Set<string>
  readOnly: boolean
  filterActive: boolean
  onRetry: () => void
  onCopyError: (text: string) => void
  onClearFilter: () => void
  onInsert: () => void
  onImport: () => void
  onToggleOne: (id: string, checked: boolean) => void
  onEdit: (doc: MongoDocument) => void
}

const MAX_CARD_FIELDS = 8

/**
 * Small-screen alternative to the documents table: one card per document with
 * a field/value list, tap-to-edit and a selection checkbox.
 */
export function DocumentsCardList({
  loading,
  error,
  documents,
  columns,
  selected,
  readOnly,
  filterActive,
  onRetry,
  onCopyError,
  onClearFilter,
  onInsert,
  onImport,
  onToggleOne,
  onEdit,
}: DocumentsCardListProps) {
  const { t } = useI18n()

  if (loading && documents.length === 0) {
    return (
      <div className="divide-y">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={`card-skeleton-${index}`} className="space-y-2 p-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  if (!loading && error && documents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <AlertCircle className="text-destructive size-6" />
        <p className="text-sm font-medium">{t("docs.queryFailed")}</p>
        <p className="text-muted-foreground max-w-sm text-xs">{error}</p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onCopyError(error)}>
            {t("common.copyDetails")}
          </Button>
          <Button size="sm" onClick={onRetry}>
            <RefreshCw /> {t("common.retry")}
          </Button>
        </div>
      </div>
    )
  }

  if (!loading && !error && documents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        {filterActive ? (
          <>
            <ListFilter className="text-muted-foreground size-6" />
            <p className="text-sm font-medium">{t("docs.noMatch")}</p>
            <p className="text-muted-foreground max-w-sm text-xs">{t("docs.noMatchHint")}</p>
            <Button variant="outline" size="sm" onClick={onClearFilter}>
              {t("docs.clearFilter")}
            </Button>
          </>
        ) : (
          <>
            <Rows3 className="text-muted-foreground size-6" />
            <p className="text-sm font-medium">{t("docs.emptyCollection")}</p>
            <p className="text-muted-foreground max-w-sm text-xs">
              {t("docs.emptyCollectionHint")}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" disabled={readOnly} onClick={onInsert}>
                <Plus /> {t("docs.insert")}
              </Button>
              <Button variant="outline" size="sm" disabled={readOnly} onClick={onImport}>
                <Upload /> {t("transfer.importAction")}
              </Button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="divide-y">
      {documents.map((doc, index) => {
        const id = documentId(doc)
        const isSelected = id !== null && selected.has(id)
        const fields = columns.filter((column) => column !== "_id").slice(0, MAX_CARD_FIELDS)
        return (
          <div
            key={id ?? index}
            data-state={isSelected ? "selected" : undefined}
            className="data-[state=selected]:bg-muted/60 p-3"
          >
            <div className="flex items-start gap-2">
              <Checkbox
                checked={isSelected}
                disabled={id === null}
                onCheckedChange={(checked) => id && onToggleOne(id, checked === true)}
                aria-label={t("docs.selectRow")}
                className="mt-0.5"
              />
              <button
                type="button"
                disabled={readOnly}
                onClick={() => onEdit(doc)}
                className="min-w-0 flex-1 text-left disabled:cursor-default"
              >
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate">
                    <CellValue value={"_id" in doc ? doc._id : undefined} />
                  </span>
                  {!readOnly ? (
                    <Pencil className="text-muted-foreground size-3 shrink-0" />
                  ) : null}
                </div>
                <dl className="mt-1.5 space-y-0.5">
                  {fields.map((column) => (
                    <div key={column} className="flex gap-2 text-xs">
                      <dt className="text-muted-foreground w-24 shrink-0 truncate font-mono">
                        {column}
                      </dt>
                      <dd className="min-w-0 flex-1">
                        <CellValue value={doc[column]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

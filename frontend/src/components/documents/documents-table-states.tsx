import { AlertCircle, ListFilter, Plus, RefreshCw, Rows3, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import { useI18n } from "@/lib/i18n"

interface DocumentsTableStatesProps {
  loading: boolean
  error: string | null
  hasDocuments: boolean
  columnCount: number
  filterActive: boolean
  readOnly: boolean
  onRetry: () => void
  onCopyError: (text: string) => void
  onClearFilter: () => void
  onInsert: () => void
  onImport: () => void
}

/**
 * The loading skeleton, error and empty states rendered as `<tbody>` rows so
 * the documents table can stay focused on the happy path.
 */
export function DocumentsTableStates({
  loading,
  error,
  hasDocuments,
  columnCount,
  filterActive,
  readOnly,
  onRetry,
  onCopyError,
  onClearFilter,
  onInsert,
  onImport,
}: DocumentsTableStatesProps) {
  const { t } = useI18n()
  const colSpan = columnCount + 2

  if (loading && !hasDocuments) {
    return (
      <>
        {Array.from({ length: 8 }).map((_, row) => (
          <TableRow key={`skeleton-${row}`} className="hover:bg-transparent">
            <TableCell>
              <Skeleton className="size-4" />
            </TableCell>
            {Array.from({ length: columnCount }).map((__, column) => (
              <TableCell key={`skeleton-${row}-${column}`}>
                <Skeleton className="h-4 w-full max-w-[180px]" />
              </TableCell>
            ))}
            <TableCell>
              <Skeleton className="h-4 w-6" />
            </TableCell>
          </TableRow>
        ))}
      </>
    )
  }

  if (!loading && error && !hasDocuments) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="h-40">
          <div className="flex flex-col items-center gap-2 text-center">
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
        </TableCell>
      </TableRow>
    )
  }

  if (!loading && !error && !hasDocuments) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="h-40">
          {filterActive ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <ListFilter className="text-muted-foreground size-6" />
              <p className="text-sm font-medium">{t("docs.noMatch")}</p>
              <p className="text-muted-foreground max-w-sm text-xs">{t("docs.noMatchHint")}</p>
              <Button variant="outline" size="sm" onClick={onClearFilter}>
                {t("docs.clearFilter")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
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
            </div>
          )}
        </TableCell>
      </TableRow>
    )
  }

  return null
}

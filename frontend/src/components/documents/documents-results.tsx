import * as React from "react"
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  Columns3,
  Copy,
  LineChart,
  Pencil,
  Pin,
  PinOff,
  Rows3,
  SlidersHorizontal,
  Timer,
  ToggleLeft,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { DocumentsCardList } from "@/components/documents/documents-card-list"
import { DocumentsTableStates } from "@/components/documents/documents-table-states"
import {
  CellValue,
  InlineCellEditor,
  cellValueOverflows,
  isPreviewableValue,
} from "@/components/documents/cell"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { FrozenColumns } from "@/hooks/useFrozenColumns"
import { useI18n } from "@/lib/i18n"
import { columnRenderMode, type ColumnPrefs, type ColumnRender } from "@/lib/columnPrefs"
import { documentId, prettyJSON } from "@/lib/mongo"
import { cn } from "@/lib/utils"
import type { MongoDocument } from "@/lib/types"

/** Inset shadow marking the right edge of the frozen region once scrolled. */
const PINNED_EDGE_SHADOW = "cell-frozen-edge"

interface DocumentsResultsProps {
  loading: boolean
  error: string | null
  total: number
  documents: MongoDocument[]
  columns: string[]
  displayColumns: string[]
  prefs: ColumnPrefs
  sortSpec: { column: string; direction: 1 | -1 } | null
  pinnedSet: Set<string>
  pinnedColumns: string[]
  frozen: FrozenColumns
  dragging: boolean
  selected: Set<string>
  selectedColumns: Set<string>
  allMatching: boolean
  allSelected: boolean
  filterActive: boolean
  readOnly: boolean
  activeRow: number | null
  activeCell: { row: number; column: string } | null
  inlineEdit: { row: number; column: string } | null
  inlineBusy: boolean

  copyText: (text: string) => void
  load: (opts?: { skip?: number; limit?: number; filter?: string; sort?: string; projection?: string }) => Promise<void>
  clearFilter: () => void

  setEditing: React.Dispatch<React.SetStateAction<{ mode: "insert" | "edit"; document?: MongoDocument } | null>>
  setTransfer: React.Dispatch<React.SetStateAction<"import" | "export" | null>>
  setInlineEdit: React.Dispatch<React.SetStateAction<{ row: number; column: string } | null>>
  setValuePreview: React.Dispatch<React.SetStateAction<{ column: string; value: unknown } | null>>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
  setAllMatching: React.Dispatch<React.SetStateAction<boolean>>
  setCellMenu: React.Dispatch<
    React.SetStateAction<{ x: number; y: number; row: number; column: string } | null>
  >
  setConfirm: React.Dispatch<
    React.SetStateAction<
      { type: "one"; document: MongoDocument } | { type: "bulk" } | { type: "filter" } | null
    >
  >
  setSort: React.Dispatch<React.SetStateAction<string>>
  setDictionaryColumn: React.Dispatch<React.SetStateAction<string | null>>
  setColumnRenderer: (column: string, renderer: ColumnRender) => void
  setActiveCell: React.Dispatch<React.SetStateAction<{ row: number; column: string } | null>>

  toggleOne: (id: string, checked: boolean) => void
  toggleAll: (checked: boolean) => void
  toggleSort: (column: string) => void
  startResize: (column: string, event: React.MouseEvent) => void
  moveColumn: (column: string, delta: 1 | -1) => void
  toggleColumnPinned: (column: string) => void
  setColumnHidden: (column: string, hidden: boolean) => void
  onSelectColumn: (column: string, additive: boolean) => void
  onVisualizeColumn: (column: string) => void
  showOnlyColumn: (column: string) => void
  resetColumns: () => void
  copyToClipboard: (text: string) => Promise<boolean>

  beginInlineEdit: (row: number, column: string) => void
  saveInlineEdit: (row: number, column: string, value: unknown) => Promise<boolean>
  canEditCell: (row: number, column: string) => boolean
  onRowMouseDown: (index: number, event: React.MouseEvent<HTMLTableRowElement>) => void
  onRowMouseEnter: (index: number) => void
  idsInRange: (a: number, b: number) => string[]
  dragMovedRef: React.MutableRefObject<boolean>
  dragAnchorRef: React.MutableRefObject<number | null>
  dragHoverRef: React.MutableRefObject<number | null>
  draggingRef: React.MutableRefObject<boolean>
  dragBaseRef: React.MutableRefObject<Set<string>>
  openUpdateDialog: () => void
}

/** Mobile cards + desktop table, including the floating selection bar. */
export function DocumentsResults({
  loading,
  error,
  total,
  documents,
  columns,
  displayColumns,
  prefs,
  sortSpec,
  pinnedSet,
  pinnedColumns,
  frozen,
  dragging,
  selected,
  selectedColumns,
  allMatching,
  allSelected,
  filterActive,
  readOnly,
  activeRow,
  activeCell,
  inlineEdit,
  inlineBusy,
  copyText,
  load,
  clearFilter,
  setEditing,
  setTransfer,
  setInlineEdit,
  setValuePreview,
  setSelected,
  setAllMatching,
  setCellMenu,
  setConfirm,
  setSort,
  setDictionaryColumn,
  setColumnRenderer,
  setActiveCell,
  toggleOne,
  toggleAll,
  toggleSort,
  startResize,
  moveColumn,
  toggleColumnPinned,
  setColumnHidden,
  onSelectColumn,
  onVisualizeColumn,
  showOnlyColumn,
  resetColumns,
  copyToClipboard,
  beginInlineEdit,
  saveInlineEdit,
  canEditCell,
  onRowMouseDown,
  onRowMouseEnter,
  idsInRange,
  dragMovedRef,
  dragAnchorRef,
  dragHoverRef,
  draggingRef,
  dragBaseRef,
  openUpdateDialog,
}: DocumentsResultsProps) {
  const { t } = useI18n()
  return (
      <div className="relative min-h-0 flex-1">
        <div className="sr-only" role="status" aria-live="polite">
          {loading
            ? t("docs.loading")
            : error
              ? t("docs.queryFailed")
              : t("docs.resultsSummary", { count: total })}
        </div>
        {error && documents.length > 0 ? (
          <div className="border-destructive/40 bg-destructive/5 text-destructive flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
            <AlertCircle className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={error}>
              {error}
            </span>
            <Button variant="outline" size="sm" onClick={() => copyText(error)}>
              {t("common.copyDetails")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load({})}>
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
        <div
          ref={frozen.scrollRef}
          onScroll={frozen.onScroll}
          className={cn("scrollbar-thin h-full overflow-auto", dragging && "select-none")}
        >
        <div className="md:hidden">
          <DocumentsCardList
            loading={loading}
            error={error}
            documents={documents}
            columns={columns}
            dictionaries={prefs.dictionaries}
            renderers={prefs.renderers}
            selected={selected}
            readOnly={readOnly}
            filterActive={filterActive}
            onRetry={() => void load({})}
            onCopyError={copyText}
            onClearFilter={clearFilter}
            onInsert={() => setEditing({ mode: "insert" })}
            onImport={() => setTransfer("import")}
            onToggleOne={toggleOne}
            onEdit={(doc) => {
              setInlineEdit(null)
              setEditing({ mode: "edit", document: doc })
            }}
            onPreview={
              readOnly ? (column, value) => setValuePreview({ column, value }) : undefined
            }
          />
        </div>
        <div className="hidden md:block">
        <Table className="min-w-[720px]">
          <TableHeader className="bg-background sticky top-0 z-20">
            <TableRow className="hover:bg-transparent">
              <TableHead
                data-sticky-checkbox
                className="cell-frozen sticky left-0 z-30 w-10"
              >
                <Checkbox
                  checked={allSelected || allMatching}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                  aria-label={t("docs.selectAll")}
                />
              </TableHead>
              {displayColumns.map((column) => {
                const direction = sortSpec?.column === column ? sortSpec.direction : undefined
                const width = prefs.widths[column]
                const isPinned = pinnedSet.has(column)
                const left = frozen.offsets[column]
                const isLastPinned = isPinned && pinnedColumns[pinnedColumns.length - 1] === column
                const isColumnSelected = selectedColumns.has(column)
                const renderMode = columnRenderMode(
                  prefs.renderers,
                  prefs.dictionaries,
                  column,
                )
                return (
                  <TableHead
                    key={column}
                    data-column={column}
                    scope="col"
                    className={cn(
                      "group font-mono text-xs",
                      isPinned ? "cell-frozen sticky z-30" : "relative",
                      isLastPinned && frozen.scrolled && PINNED_EDGE_SHADOW,
                      isColumnSelected && "bg-primary/10 text-foreground",
                    )}
                    style={{
                      ...(width ? { width, minWidth: width, maxWidth: width } : {}),
                      ...(isPinned && left !== undefined ? { left } : {}),
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
                            event.preventDefault()
                            onSelectColumn(
                              column,
                              event.metaKey || event.ctrlKey || event.shiftKey,
                            )
                            return
                          }
                          toggleSort(column)
                        }}
                        title={
                          direction
                            ? direction === 1
                              ? t("docs.sortedAsc")
                              : t("docs.sortedDesc")
                            : t("docs.sortBy", { column })
                        }
                        aria-pressed={isColumnSelected}
                        className={cn(
                          "hover:text-foreground flex min-w-0 flex-1 items-center gap-1 rounded",
                          isColumnSelected && "text-primary",
                        )}
                      >
                        <span className="truncate">{column}</span>
                        {isColumnSelected ? (
                          <Columns3 className="text-primary size-3 shrink-0" />
                        ) : null}
                        {renderMode === "dictionary" ? (
                          <BookOpen className="text-primary size-3 shrink-0" />
                        ) : renderMode === "checkbox" ? (
                          <CheckSquare className="text-primary size-3 shrink-0" />
                        ) : renderMode === "switch" ? (
                          <ToggleLeft className="text-primary size-3 shrink-0" />
                        ) : renderMode === "date" ? (
                          <CalendarDays className="text-primary size-3 shrink-0" />
                        ) : null}
                        {direction === 1 ? (
                          <ArrowUp className="size-3 shrink-0" />
                        ) : direction === -1 ? (
                          <ArrowDown className="size-3 shrink-0" />
                        ) : (
                          <ArrowUpDown className="size-3 shrink-0 opacity-0 group-hover:opacity-60" />
                        )}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            title={t("docs.columnActions")}
                            aria-label={t("docs.columnActions")}
                            className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                          >
                            <ChevronDown className="size-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-52">
                          <DropdownMenuItem onSelect={() => onSelectColumn(column, true)}>
                            <Columns3 />{" "}
                            {isColumnSelected
                              ? t("docs.deselectColumn")
                              : t("docs.selectColumn")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => onVisualizeColumn(column)}>
                            <LineChart /> {t("docs.visualizeColumn")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => toggleSort(column)}>
                            {direction === 1 ? t("docs.sortDesc") : t("docs.sortAsc")}
                          </DropdownMenuItem>
                          {direction ? (
                            <DropdownMenuItem
                              onSelect={() => {
                                setSort("")
                                void load({ skip: 0, sort: "" })
                              }}
                            >
                              {t("docs.clearSort")}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <SlidersHorizontal /> {t("docs.renderAs")}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-48">
                              <DropdownMenuItem onSelect={() => setColumnRenderer(column, "default")}>
                                <Rows3 /> {t("docs.render.default")}
                                {renderMode === "default" ? <Check className="ml-auto size-4" /> : null}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setDictionaryColumn(column)}>
                                <BookOpen /> {t("docs.render.dictionary")}
                                {renderMode === "dictionary" ? <Check className="ml-auto size-4" /> : null}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setColumnRenderer(column, "checkbox")}>
                                <CheckSquare /> {t("docs.render.checkbox")}
                                {renderMode === "checkbox" ? <Check className="ml-auto size-4" /> : null}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setColumnRenderer(column, "switch")}>
                                <ToggleLeft /> {t("docs.render.switch")}
                                {renderMode === "switch" ? <Check className="ml-auto size-4" /> : null}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setColumnRenderer(column, "date")}>
                                <CalendarDays /> {t("docs.render.date")}
                                {renderMode === "date" ? <Check className="ml-auto size-4" /> : null}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => setColumnRenderer(column, "duration")}
                              >
                                <Timer /> {t("docs.render.duration")}
                                {renderMode === "duration" ? (
                                  <Check className="ml-auto size-4" />
                                ) : null}
                              </DropdownMenuItem>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuItem
                            onSelect={() =>
                              void copyToClipboard(column).then((ok) =>
                                ok
                                  ? toast.success(t("common.copied"))
                                  : toast.error(t("common.copyFailed")),
                              )
                            }
                          >
                            <Copy /> {t("docs.copyField")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => moveColumn(column, -1)}>
                            <ArrowLeft /> {t("docs.moveLeft")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => moveColumn(column, 1)}>
                            <ArrowRight /> {t("docs.moveRight")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => toggleColumnPinned(column)}>
                            {isPinned ? <PinOff /> : <Pin />}
                            {isPinned ? t("docs.unpinColumn") : t("docs.pinColumn")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => setColumnHidden(column, true)}>
                            {t("docs.hideColumn")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => showOnlyColumn(column)}>
                            {t("docs.showOnly")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={resetColumns}>
                            {t("docs.resetColumns")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      onMouseDown={(event) => startResize(column, event)}
                      className="hover:bg-primary/40 absolute inset-y-0 right-0 w-1 cursor-col-resize"
                    />
                  </TableHead>
                )
              })}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody
            onContextMenu={(event) => {
              const td = (event.target as HTMLElement).closest("td[data-column]")
              const tr = (event.target as HTMLElement).closest("tr[data-row-index]")
              const column = td?.getAttribute("data-column")
              const raw = tr?.getAttribute("data-row-index")
              if (!column || raw === null || raw === undefined) return
              event.preventDefault()
              setCellMenu({ x: event.clientX, y: event.clientY, row: Number(raw), column })
            }}
            onMouseMove={(event) => {
              const tr = (event.target as HTMLElement).closest("tr")
              const raw = tr?.getAttribute("data-row-index")
              if (raw !== null && raw !== undefined) onRowMouseEnter(Number(raw))
            }}
            onMouseUp={(event) => {
              // Finalize on the row under the pointer: the last mousemove before
              // mouseup can be coalesced, which would drop the end row.
              if (!draggingRef.current || dragAnchorRef.current === null) return
              const tr = (event.target as HTMLElement).closest("tr")
              const raw = tr?.getAttribute("data-row-index")
              if (raw === null || raw === undefined) return
              const idx = Number(raw)
              dragHoverRef.current = idx
              setSelected(
                new Set([...dragBaseRef.current, ...idsInRange(dragAnchorRef.current, idx)]),
              )
            }}
          >
            <DocumentsTableStates
              loading={loading}
              error={error}
              hasDocuments={documents.length > 0}
              columnCount={columns.length}
              filterActive={filterActive}
              readOnly={readOnly}
              onRetry={() => void load({})}
              onCopyError={copyText}
              onClearFilter={clearFilter}
              onInsert={() => setEditing({ mode: "insert" })}
              onImport={() => setTransfer("import")}
            />
            {documents.map((doc, index) => {
              const id = documentId(doc)
              const isSelected = id !== null && selected.has(id)
              return (
                <TableRow
                  key={id ?? index}
                  data-row-index={index}
                  data-state={isSelected ? "selected" : undefined}
                  data-active={activeRow === index ? "true" : undefined}
                  className={cn("group", activeRow === index && "bg-accent/40 hover:bg-accent/40")}
                  style={{ contentVisibility: "auto", containIntrinsicSize: "auto 2rem" }}
                  onMouseDown={(event) => onRowMouseDown(index, event)}
                  onDoubleClick={() => {
                    if (dragMovedRef.current) {
                      dragMovedRef.current = false
                      return
                    }
                    setInlineEdit(null)
                    if (!readOnly) setEditing({ mode: "edit", document: doc })
                  }}
                >
                  <TableCell
                    data-sticky-checkbox
                    className="cell-frozen sticky left-0 z-10 w-10"
                  >
                    <Checkbox
                      checked={isSelected}
                      disabled={id === null}
                      onCheckedChange={(checked) => id && toggleOne(id, checked === true)}
                      aria-label={t("docs.selectRow")}
                    />
                  </TableCell>
                  {displayColumns.map((column) => {
                    const isPinned = pinnedSet.has(column)
                    const left = frozen.offsets[column]
                    const isLastPinned =
                      isPinned && pinnedColumns[pinnedColumns.length - 1] === column
                    const isColumnSelected = selectedColumns.has(column)
                    const isEditing =
                      inlineEdit?.row === index && inlineEdit.column === column
                    const isActiveCell =
                      activeCell?.row === index && activeCell.column === column
                    const previewable = readOnly && isPreviewableValue(doc[column])
                    return (
                      <TableCell
                        key={column}
                        data-column={column}
                        data-active-cell={isActiveCell ? "true" : undefined}
                        className={cn(
                          "max-w-[320px]",
                          !isEditing && "truncate",
                          previewable && "cursor-pointer",
                          isColumnSelected && "bg-primary/5",
                          isActiveCell && "bg-primary/10 ring-primary/60 ring-1 ring-inset",
                          isPinned && "cell-frozen sticky z-10",
                          isLastPinned && frozen.scrolled && PINNED_EDGE_SHADOW,
                        )}
                        style={{
                          ...(prefs.widths[column]
                            ? {
                                width: prefs.widths[column],
                                minWidth: prefs.widths[column],
                                maxWidth: prefs.widths[column],
                              }
                            : {}),
                          ...(isPinned && left !== undefined ? { left } : {}),
                        }}
                        onClick={
                          readOnly
                            ? (event) => {
                                setActiveCell({ row: index, column })
                                if (!cellValueOverflows(event.currentTarget)) return
                                setValuePreview({ column, value: doc[column] })
                              }
                            : () => setActiveCell({ row: index, column })
                        }
                        onDoubleClick={(event) => {
                          if (!canEditCell(index, column)) return
                          event.stopPropagation()
                          beginInlineEdit(index, column)
                        }}
                      >
                        {isEditing ? (
                          <InlineCellEditor
                            value={doc[column]}
                            busy={inlineBusy}
                            onSave={(value) => saveInlineEdit(index, column, value)}
                            onCancel={() => setInlineEdit(null)}
                          />
                        ) : (
                          <CellValue
                            value={doc[column]}
                            dictionary={prefs.dictionaries[column]}
                            renderer={columnRenderMode(
                              prefs.renderers,
                              prefs.dictionaries,
                              column,
                            )}
                            toggleDisabled={inlineBusy}
                            onToggle={
                              canEditCell(index, column) &&
                              (prefs.renderers[column] === "checkbox" ||
                                prefs.renderers[column] === "switch")
                                ? (next) => void saveInlineEdit(index, column, next)
                                : undefined
                            }
                            onExpand={
                              readOnly
                                ? () => setValuePreview({ column, value: doc[column] })
                                : undefined
                            }
                          />
                        )}
                      </TableCell>
                    )
                  })}
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={t("docs.rowActions")}>
                          <Rows3 />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          disabled={readOnly}
                          onSelect={() => {
                            setInlineEdit(null)
                            setEditing({ mode: "edit", document: doc })
                          }}
                        >
                          <Pencil /> {t("docs.editDocument")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            void copyToClipboard(prettyJSON(doc)).then((ok) =>
                              ok
                                ? toast.success(t("docs.copyOk"))
                                : toast.error(t("common.copyFailed")),
                            )
                          }}
                        >
                          <Copy /> {t("docs.copyJson")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={readOnly || !id}
                          onSelect={() => setConfirm({ type: "one", document: doc })}
                        >
                          <Trash2 /> {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        </div>
        </div>

        {selected.size > 0 || allMatching ? (
          <div className="bg-background/95 absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap shadow-lg backdrop-blur">
            <span className="text-muted-foreground">
              {allMatching
                ? t("docs.selectedAllMatching", { count: total })
                : t("docs.selected", { count: selected.size })}
            </span>
            {!allMatching && total > documents.length && selected.size === documents.length ? (
              <Button variant="outline" size="sm" onClick={() => setAllMatching(true)}>
                {t("docs.selectAllMatching", { count: total })}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={readOnly}
              onClick={openUpdateDialog}
            >
              <Pencil /> {t("docs.updateSelected")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={readOnly}
              onClick={() => setConfirm({ type: "bulk" })}
            >
              <Trash2 /> {t("docs.deleteSelected")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(new Set())
                setAllMatching(false)
              }}
            >
              {t("docs.clear")}
            </Button>
          </div>
        ) : null}
      </div>

  )
}

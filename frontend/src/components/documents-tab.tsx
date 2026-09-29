import * as React from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rows3,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { DocumentDialog } from "@/components/document-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { JsonEditor } from "@/components/json-editor"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { copyToClipboard } from "@/lib/clipboard"
import { classForType, collectColumns, documentId, formatValue, prettyJSON, valueType } from "@/lib/mongo"
import { cn } from "@/lib/utils"
import type { FindResult, MongoDocument } from "@/lib/types"

interface DocumentsTabProps {
  connectionId: string
  database: string
  collection: string
  readOnly: boolean
}

interface EditingState {
  mode: "insert" | "edit"
  document?: MongoDocument
}

function CellValue({ value }: { value: unknown }) {
  const type = valueType(value)
  const text = formatValue(value)
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground font-mono text-xs italic">null</span>
  }
  const display = text.length > 90 ? `${text.slice(0, 90)}…` : text
  return (
    <span className={cn("font-mono text-xs", classForType(type))} title={text}>
      {display}
    </span>
  )
}

export function DocumentsTab({
  connectionId,
  database,
  collection,
  readOnly,
}: DocumentsTabProps) {
  const { t } = useI18n()
  const [filter, setFilter] = React.useState("{}")
  const [sort, setSort] = React.useState("")
  const [projection, setProjection] = React.useState("")
  const [limit, setLimit] = React.useState(50)
  const [skip, setSkip] = React.useState(0)
  const [showOptions, setShowOptions] = React.useState(false)
  const [result, setResult] = React.useState<FindResult | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [editing, setEditing] = React.useState<EditingState | null>(null)
  const [confirm, setConfirm] = React.useState<
    | { type: "one"; document: MongoDocument }
    | { type: "bulk" }
    | { type: "filter" }
    | null
  >(null)

  const load = React.useCallback(
    async (opts?: {
      skip?: number
      limit?: number
      filter?: string
      sort?: string
      projection?: string
    }) => {
      const filterText = opts?.filter ?? filter
      const sortText = opts?.sort ?? sort
      const projectionText = opts?.projection ?? projection
      const nextSkip = opts?.skip ?? skip
      const nextLimit = opts?.limit ?? limit

      let filterObj: unknown
      let sortObj: unknown
      let projectionObj: unknown
      try {
        filterObj = JSON.parse(filterText.trim() || "{}")
        sortObj = sortText.trim() ? JSON.parse(sortText) : undefined
        projectionObj = projectionText.trim() ? JSON.parse(projectionText) : undefined
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("docs.invalidJson"))
        return
      }

      setLoading(true)
      try {
        const res = await api.find(connectionId, database, collection, {
          filter: filterObj,
          sort: sortObj,
          projection: projectionObj,
          skip: nextSkip,
          limit: nextLimit,
        })
        setResult(res)
        setSkip(res.skip)
        setSelected(new Set())
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("docs.queryFailed"))
      } finally {
        setLoading(false)
      }
    },
    [connectionId, database, collection, filter, sort, projection, skip, limit],
  )

  React.useEffect(() => {
    setFilter("{}")
    setSort("")
    setProjection("")
    setSkip(0)
    setResult(null)
    void load({ skip: 0, limit: 50, filter: "{}", sort: "", projection: "" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, database, collection])

  const documents = result?.documents ?? []
  const columns = React.useMemo(() => collectColumns(documents), [documents])

  // Reflect the sort JSON in the table headers so columns can be toggled by
  // clicking. Only a single-key sort is represented in the header UI.
  const sortSpec = React.useMemo(() => {
    try {
      const parsed = sort.trim() ? JSON.parse(sort) : null
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed)
        if (keys.length === 1 && (parsed[keys[0]] === 1 || parsed[keys[0]] === -1)) {
          return { column: keys[0], direction: parsed[keys[0]] as 1 | -1 }
        }
      }
    } catch {
      /* ignore invalid JSON while the user is typing */
    }
    return null
  }, [sort])

  const toggleSort = (column: string) => {
    let direction: 1 | -1 | null = 1
    if (sortSpec?.column === column) {
      direction = sortSpec.direction === 1 ? -1 : null
    }
    const nextSort = direction ? JSON.stringify({ [column]: direction }) : ""
    setSort(nextSort)
    void load({ skip: 0, sort: nextSort })
  }
  const total = result?.total ?? 0
  const page = Math.floor(skip / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected(new Set())
      return
    }
    const next = new Set<string>()
    for (const doc of documents) {
      const id = documentId(doc)
      if (id) next.add(id)
    }
    setSelected(next)
  }

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleInsert = async (value: unknown) => {
    const docs = Array.isArray(value) ? value : [value]
    const res = await api.insert(connectionId, database, collection, docs as MongoDocument[])
    toast.success(
      t(res.insertedCount === 1 ? "docs.insertedOne" : "docs.insertedMany", {
        count: res.insertedCount,
      }),
    )
    await load({ skip: 0 })
  }

  const handleUpdate = async (value: unknown) => {
    const doc = value as MongoDocument
    if (!editing?.document || !("_id" in editing.document)) {
      throw new Error(t("docs.noId"))
    }
    await api.update(connectionId, database, collection, {
      filter: { _id: editing.document._id },
      update: doc,
    })
    toast.success(t("docs.updated"))
    await load({})
  }

  const runConfirm = async () => {
    if (!confirm) return
    if (confirm.type === "one") {
      await api.remove(connectionId, database, collection, {
        filter: { _id: confirm.document._id },
      })
      toast.success(t("docs.deleted"))
    } else if (confirm.type === "bulk") {
      const ids = Array.from(selected).map((raw) => JSON.parse(raw))
      await api.remove(connectionId, database, collection, {
        filter: { _id: { $in: ids } },
        many: true,
      })
      toast.success(t("docs.deletedMany", { count: ids.length }))
    } else {
      const parsed = JSON.parse(filter.trim() || "{}")
      const res = await api.remove(connectionId, database, collection, {
        filter: parsed,
        many: true,
      })
      toast.success(t("docs.deletedMany", { count: res.deletedCount }))
    }
    await load({ skip: 0 })
  }

  const allSelected = documents.length > 0 && documents.every((doc) => {
    const id = documentId(doc)
    return id !== null && selected.has(id)
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="shrink-0 space-y-2 border-b p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load({ skip: 0 })
              }}
              placeholder={t("docs.filterPlaceholder")}
              className="pr-14 font-mono text-xs"
            />
            <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[10px] tracking-wide uppercase">
              {t("docs.filter")}
            </span>
          </div>
          <Button onClick={() => void load({ skip: 0 })} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Play />}
            {t("common.run")}
          </Button>
          <Button variant="outline" size="icon" onClick={() => void load({})} title={t("common.refresh")}>
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowOptions((prev) => !prev)}
            title={t("docs.sortProjection")}
          >
            <Rows3 />
            <ChevronDown className={cn("transition-transform", showOptions && "rotate-180")} />
          </Button>
          <Button
            onClick={() => setEditing({ mode: "insert" })}
            disabled={readOnly}
            title={readOnly ? t("docs.readonlyTip") : t("docs.insertTitle")}
          >
            <Plus /> {t("docs.insert")}
          </Button>
        </div>

        {showOptions ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("docs.sort")}</Label>
              <JsonEditor
                value={sort}
                onChange={setSort}
                placeholder='{ "createdAt": -1 }'
                className="min-h-[4rem]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("docs.projection")}</Label>
              <JsonEditor
                value={projection}
                onChange={setProjection}
                placeholder='{ "name": 1, "email": 1 }'
                className="min-h-[4rem]"
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Selection actions */}
      {selected.size > 0 ? (
        <div className="bg-muted/50 flex shrink-0 items-center gap-3 border-b px-3 py-2 text-sm">
          <span>{t("docs.selected", { count: selected.size })}</span>
          <Button
            variant="destructive"
            size="sm"
            disabled={readOnly}
            onClick={() => setConfirm({ type: "bulk" })}
          >
            <Trash2 /> {t("docs.deleteSelected")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            {t("docs.clear")}
          </Button>
        </div>
      ) : null}

      {/* Table */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                  aria-label="Select all"
                />
              </TableHead>
              {columns.map((column) => {
                const direction = sortSpec?.column === column ? sortSpec.direction : undefined
                return (
                  <TableHead key={column} className="group font-mono text-xs">
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      title={
                        direction
                          ? direction === 1
                            ? t("docs.sortedAsc")
                            : t("docs.sortedDesc")
                          : t("docs.sortBy", { column })
                      }
                      className="hover:text-foreground -mx-1 flex items-center gap-1 rounded px-1"
                    >
                      <span className="truncate">{column}</span>
                      {direction === 1 ? (
                        <ArrowUp className="size-3 shrink-0" />
                      ) : direction === -1 ? (
                        <ArrowDown className="size-3 shrink-0" />
                      ) : (
                        <ArrowUpDown className="size-3 shrink-0 opacity-0 group-hover:opacity-60" />
                      )}
                    </button>
                  </TableHead>
                )
              })}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && documents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className="h-32 text-center">
                  <Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : null}
            {!loading && documents.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 2}
                  className="text-muted-foreground h-32 text-center text-sm"
                >
                  No documents match this query.
                </TableCell>
              </TableRow>
            ) : null}
            {documents.map((doc, index) => {
              const id = documentId(doc)
              const isSelected = id !== null && selected.has(id)
              return (
                <TableRow
                  key={id ?? index}
                  data-state={isSelected ? "selected" : undefined}
                  onDoubleClick={() => !readOnly && setEditing({ mode: "edit", document: doc })}
                >
                  <TableCell>
                    <Checkbox
                      checked={isSelected}
                      disabled={id === null}
                      onCheckedChange={(checked) => id && toggleOne(id, checked === true)}
                      aria-label="Select row"
                    />
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column} className="max-w-[320px] truncate">
                      <CellValue value={doc[column]} />
                    </TableCell>
                  ))}
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <Rows3 />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          disabled={readOnly}
                          onSelect={() => setEditing({ mode: "edit", document: doc })}
                        >
                          <Pencil /> Edit document
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
                          <Copy /> Copy JSON
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={readOnly || !id}
                          onSelect={() => setConfirm({ type: "one", document: doc })}
                        >
                          <Trash2 /> Delete
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

      {/* Pagination */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {total === 0 ? "0" : `${skip + 1}–${Math.min(skip + limit, total)}`} of {total}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Rows</span>
          <Select
            value={String(limit)}
            onValueChange={(value) => {
              const nextLimit = Number(value)
              setLimit(nextLimit)
              void load({ skip: 0, limit: nextLimit })
            }}
          >
            <SelectTrigger size="sm" className="w-[72px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100, 250].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={skip <= 0 || loading}
            onClick={() => void load({ skip: Math.max(0, skip - limit) })}
          >
            <ChevronLeft />
          </Button>
          <span className="text-muted-foreground px-2 text-xs">
            {t("docs.page", { page, pages })}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={skip + limit >= total || loading}
            onClick={() => void load({ skip: skip + limit })}
          >
            <ChevronRight />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled={readOnly}>
                <Trash2 />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirm({ type: "filter" })}
              >
                <Trash2 /> {t("docs.deleteMatching")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DocumentDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.mode === "edit" ? t("docs.editTitle") : t("docs.insertTitle")}
        description={editing?.mode === "edit" ? t("docs.editDesc") : t("docs.insertDesc")}
        initialValue={
          editing?.mode === "edit" && editing.document ? prettyJSON(editing.document) : "{\n  \n}"
        }
        submitLabel={editing?.mode === "edit" ? t("docs.saveChanges") : t("docs.insertAction")}
        onSubmit={editing?.mode === "edit" ? handleUpdate : handleInsert}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm?.type === "filter"
            ? t("docs.deleteFilter")
            : confirm?.type === "bulk"
              ? t("docs.deleteSelectedMany", { count: selected.size })
              : t("docs.deleteOne")
        }
        description={t("docs.deleteDesc")}
        confirmLabel={t("common.delete")}
        onConfirm={runConfirm}
      />
    </div>
  )
}

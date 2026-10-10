import * as React from "react"
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { IndexEditorDialog } from "@/components/index-editor-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { isPlainObject, formatValue } from "@/lib/mongo"
import type { IndexInfo } from "@/lib/types"

interface IndexesTabProps {
  connectionId: string
  database: string
  collection: string
  readOnly: boolean
}

function describeKeys(value: unknown): string {
  if (!isPlainObject(value)) return formatValue(value)
  return Object.entries(value)
    .map(([field, direction]) => `${field}: ${String(direction)}`)
    .join(", ")
}

function indexBadges(index: IndexInfo): string[] {
  const badges: string[] = []
  if (index.unique) badges.push("unique")
  if (index.sparse) badges.push("sparse")
  if (index.expireAfterSeconds !== undefined) badges.push(`ttl ${String(index.expireAfterSeconds)}s`)
  if (index.partialFilterExpression) badges.push("partial")
  if (index.hidden) badges.push("hidden")
  if (isPlainObject(index.key)) {
    const values = Object.values(index.key).map((value) => String(value))
    if (values.includes("text")) badges.push("text")
    if (values.includes("2dsphere") || values.includes("2d")) badges.push("geo")
    if (values.includes("hashed")) badges.push("hashed")
  }
  return badges
}

export function IndexesTab({
  connectionId,
  database,
  collection,
  readOnly,
}: IndexesTabProps) {
  const { t } = useI18n()
  const [indexes, setIndexes] = React.useState<IndexInfo[]>([])
  const [loading, setLoading] = React.useState(false)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<IndexInfo | null>(null)
  const [dropTarget, setDropTarget] = React.useState<string | null>(null)
  const [busyAction, setBusyAction] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.listIndexes(connectionId, database, collection)
      setIndexes(res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("indexes.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, collection, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setEditorOpen(true)
  }

  const openEdit = (index: IndexInfo) => {
    setEditing(index)
    setEditorOpen(true)
  }

  const toggleHidden = async (index: IndexInfo) => {
    setBusyAction(index.name)
    try {
      await api.updateIndex(connectionId, database, collection, index.name, {
        hidden: !index.hidden,
      })
      toast.success(index.hidden ? t("indexes.unhidden") : t("indexes.hiddenToast"))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("indexes.updateFailed"))
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <span className="text-sm font-medium">
          {t(indexes.length === 1 ? "indexes.countOne" : "indexes.count", { count: indexes.length })}
        </span>
        <Button variant="outline" size="icon-sm" onClick={() => void load()} title={t("common.refresh")}>
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          disabled={readOnly}
          onClick={openCreate}
        >
          <Plus /> {t("indexes.createTitle")}
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("indexes.name")}</TableHead>
              <TableHead>{t("indexes.keys")}</TableHead>
              <TableHead>{t("indexes.properties")}</TableHead>
              <TableHead className="w-28 text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && indexes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  <Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : null}
            {indexes.map((index) => {
              const name = index.name
              const isDefault = name === "_id_"
              const badges = indexBadges(index)
              const busy = busyAction === name
              return (
                <TableRow key={name}>
                  <TableCell className="font-mono text-xs">
                    <span className="flex items-center gap-2">
                      {isDefault ? (
                        <KeyRound className="size-3.5 text-amber-500 dark:text-amber-400" />
                      ) : null}
                      {name}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{describeKeys(index.key)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {badges.length === 0 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        badges.map((badge) => (
                          <Badge key={badge} variant={badge === "hidden" ? "outline" : "secondary"}>
                            {badge}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={readOnly || isDefault || busy}
                        title={index.hidden ? t("indexes.unhide") : t("indexes.hide")}
                        onClick={() => void toggleHidden(index)}
                      >
                        {busy ? (
                          <Loader2 className="animate-spin" />
                        ) : index.hidden ? (
                          <EyeOff />
                        ) : (
                          <Eye />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={readOnly}
                        title={t("indexes.edit")}
                        onClick={() => openEdit(index)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={readOnly || isDefault}
                        title={isDefault ? t("indexes.cannotDrop") : t("indexes.drop")}
                        onClick={() => setDropTarget(name)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <IndexEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        connectionId={connectionId}
        database={database}
        collection={collection}
        index={editing}
        onSaved={() => void load()}
      />

      <ConfirmDialog
        open={dropTarget !== null}
        onOpenChange={(open) => !open && setDropTarget(null)}
        title={t("indexes.dropTitle", { name: dropTarget ?? "" })}
        description={t("indexes.dropDesc")}
        confirmLabel={t("indexes.dropLabel")}
        onConfirm={async () => {
          if (!dropTarget) return
          await api.dropIndex(connectionId, database, collection, dropTarget)
          toast.success(t("indexes.dropped"))
          await load()
        }}
      />
    </div>
  )
}

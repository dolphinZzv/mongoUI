import * as React from "react"
import { KeyRound, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
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
import { isPlainObject, formatValue } from "@/lib/mongo"
import type { MongoDocument } from "@/lib/types"

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

function indexProperties(index: MongoDocument): string[] {
  const props: string[] = []
  if (index.unique) props.push("unique")
  if (index.sparse) props.push("sparse")
  if (index.expireAfterSeconds !== undefined) props.push(`ttl ${String(index.expireAfterSeconds)}s`)
  if (index.partialFilterExpression) props.push("partial")
  if (index.hidden) props.push("hidden")
  return props
}

export function IndexesTab({
  connectionId,
  database,
  collection,
  readOnly,
}: IndexesTabProps) {
  const { t } = useI18n()
  const [indexes, setIndexes] = React.useState<MongoDocument[]>([])
  const [loading, setLoading] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [keys, setKeys] = React.useState('{\n  "field": 1\n}')
  const [options, setOptions] = React.useState("{}")
  const [busy, setBusy] = React.useState(false)
  const [dropTarget, setDropTarget] = React.useState<string | null>(null)

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
  }, [connectionId, database, collection])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    let parsedKeys: unknown
    let parsedOptions: unknown
    try {
      parsedKeys = JSON.parse(keys)
      parsedOptions = JSON.parse(options || "{}")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("indexes.invalidJson"))
      return
    }
    setBusy(true)
    try {
      await api.createIndex(connectionId, database, collection, parsedKeys, parsedOptions)
      toast.success(t("indexes.created"))
      setCreateOpen(false)
      setKeys('{\n  "field": 1\n}')
      setOptions("{}")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("indexes.createFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <span className="text-sm font-medium">
          {indexes.length} index{indexes.length === 1 ? "" : "es"}
        </span>
        <Button variant="outline" size="icon-sm" onClick={() => void load()} title={t("common.refresh")}>
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          disabled={readOnly}
          onClick={() => setCreateOpen(true)}
        >
          <Plus /> Create index
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("indexes.name")}</TableHead>
              <TableHead>{t("indexes.keys")}</TableHead>
              <TableHead>{t("indexes.properties")}</TableHead>
              <TableHead className="w-12" />
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
              const name = String(index.name ?? "")
              const isDefault = name === "_id_"
              const props = indexProperties(index)
              return (
                <TableRow key={name}>
                  <TableCell className="font-mono text-xs">
                    <span className="flex items-center gap-2">
                      {isDefault ? <KeyRound className="text-amber-500 dark:text-amber-400 size-3.5" /> : null}
                      {name}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{describeKeys(index.key)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {props.length === 0 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        props.map((prop) => (
                          <Badge key={prop} variant="secondary">
                            {prop}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={readOnly || isDefault}
                      title={isDefault ? t("indexes.cannotDrop") : t("indexes.drop")}
                      onClick={() => setDropTarget(name)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>{t("indexes.createTitle")}</DialogTitle>
              <DialogDescription>
                Specify the index keys and any options using Extended JSON.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-1">
                <Label>{t("indexes.keys")}</Label>
                <JsonEditor value={keys} onChange={setKeys} allowEmpty={false} rows={4} />
              </div>
              <div className="space-y-1">
                <Label>{t("indexes.options")}</Label>
                <JsonEditor
                  value={options}
                  onChange={setOptions}
                  rows={4}
                  placeholder='{ "unique": true, "name": "email_unique" }'
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={dropTarget !== null}
        onOpenChange={(open) => !open && setDropTarget(null)}
        title={t("indexes.dropTitle", { name: dropTarget ?? "" })}
        description="The index will be removed from the collection."
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

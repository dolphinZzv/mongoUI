import * as React from "react"
import { Loader2, PlugZap, Save } from "lucide-react"
import { toast } from "sonner"

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
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Connection } from "@/lib/types"

const COLORS = [
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#64748b",
]

const SUGGESTIONS = [
  { label: "Local", uri: "mongodb://127.0.0.1:27017" },
  { label: "Docker", uri: "mongodb://root:example@127.0.0.1:27017/?authSource=admin" },
  { label: "Atlas SRV", uri: "mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/" },
]

interface ConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection?: Connection | null
  onSaved: (connection: Connection) => void
}

const EMPTY = { name: "", uri: "", color: COLORS[0], readOnly: false }

export function ConnectionDialog({
  open,
  onOpenChange,
  connection,
  onSaved,
}: ConnectionDialogProps) {
  const [form, setForm] = React.useState(EMPTY)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    if (connection) {
      setForm({
        name: connection.name,
        uri: connection.uri,
        color: connection.color || COLORS[0],
        readOnly: Boolean(connection.readOnly),
      })
    } else {
      setForm(EMPTY)
    }
  }, [open, connection])

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const handleTest = async () => {
    if (!form.uri.trim()) {
      toast.error("Please enter a connection string first")
      return
    }
    setTesting(true)
    try {
      const res = await api.testConnection({
        name: form.name || "test",
        uri: form.uri,
        color: form.color,
        readOnly: form.readOnly,
      })
      toast.success(res.message || "Connection successful")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim() || !form.uri.trim()) {
      toast.error("Name and connection string are required")
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        uri: form.uri.trim(),
        color: form.color,
        readOnly: form.readOnly,
      }
      const saved = connection
        ? await api.updateConnection(connection.id, payload)
        : await api.createConnection(payload)
      toast.success(connection ? "Connection updated" : "Connection created")
      onSaved(saved)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save connection")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{connection ? "Edit connection" : "New connection"}</DialogTitle>
            <DialogDescription>
              Store a MongoDB connection string. Credentials are kept locally on the server.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="conn-name">Name</Label>
              <Input
                id="conn-name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Local development"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="conn-uri">Connection string</Label>
              <Input
                id="conn-uri"
                value={form.uri}
                onChange={(e) => update("uri", e.target.value)}
                placeholder="mongodb://user:password@host:27017/?authSource=admin"
                className="font-mono text-xs"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => update("uri", s.uri)}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-full border px-2.5 py-0.5 text-xs transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex flex-wrap items-center gap-2">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    onClick={() => update("color", color)}
                    className={cn(
                      "size-6 rounded-full border-2 transition-transform",
                      form.color === color
                        ? "border-foreground scale-110"
                        : "border-transparent hover:scale-105",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="conn-readonly">Read-only mode</Label>
                <p className="text-muted-foreground text-xs">
                  Disable all write operations for this connection.
                </p>
              </div>
              <Switch
                id="conn-readonly"
                checked={form.readOnly}
                onCheckedChange={(checked) => update("readOnly", checked)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
              Test connection
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                {connection ? "Save changes" : "Create"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

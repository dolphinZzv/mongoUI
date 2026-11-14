import * as React from "react"
import { Check, Loader2, RefreshCw, RotateCcw, ShieldCheck, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import type { AIProposal } from "@/lib/types"

interface AIProposalsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  approved: "default",
  applying: "secondary",
  applied: "secondary",
  failed: "destructive",
  rejected: "outline",
  rolled_back: "outline",
}

/** Admin review queue for MCP/write proposals created with propose=true. */
export function AIProposalsDialog({ open, onOpenChange }: AIProposalsDialogProps) {
  const { t } = useI18n()
  const [proposals, setProposals] = React.useState<AIProposal[]>([])
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.listAIProposals()
      setProposals(res.proposals ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("aiApprovals.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    if (open) void load()
  }, [open, load])

  const act = async (id: string, action: "approve" | "reject" | "apply" | "rollback") => {
    setBusy(id)
    try {
      if (action === "approve") await api.approveAIProposal(id)
      else if (action === "reject") await api.rejectAIProposal(id)
      else if (action === "apply") await api.applyAIProposal(id)
      else await api.rollbackAIProposal(id)
      toast.success(t(`aiApprovals.action.${action}`))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("aiApprovals.actionFailed"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="text-primary size-4" />
            {t("aiApprovals.title")}
          </DialogTitle>
          <DialogDescription>{t("aiApprovals.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            {t("aiApprovals.count", { count: proposals.length })}
          </p>
          <Button variant="ghost" size="icon-sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-auto">
          {!loading && proposals.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {t("aiApprovals.empty")}
            </p>
          ) : null}
          {proposals.map((proposal) => {
            const isBusy = busy === proposal.id
            const preview =
              proposal.preview && typeof proposal.preview === "object"
                ? JSON.stringify(proposal.preview, null, 2)
                : String(proposal.preview ?? "")
            return (
              <div key={proposal.id} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{proposal.summary}</span>
                  <Badge variant={STATUS_VARIANT[proposal.status] ?? "outline"}>
                    {t(`aiApprovals.status.${proposal.status}`)}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {proposal.connectionId} / {proposal.database} / {proposal.collection}
                  </span>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {proposal.createdAt ? new Date(proposal.createdAt).toLocaleString() : ""}
                  </span>
                </div>
                {proposal.error ? (
                  <p className="text-destructive text-xs">{proposal.error}</p>
                ) : null}
                <pre className="bg-muted/40 scrollbar-thin max-h-48 overflow-auto rounded p-2 font-mono text-[11px]">
                  {preview}
                </pre>
                <div className="flex flex-wrap items-center gap-2">
                  {proposal.count > 0 ? (
                    <span className="text-muted-foreground text-xs">
                      {t("aiApprovals.matches", { count: proposal.count })}
                    </span>
                  ) : null}
                  {proposal.rollbackable ? (
                    <Badge variant="outline" className="text-[9px]">
                      {t("aiApprovals.rollbackable")}
                    </Badge>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1.5">
                    {proposal.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => void act(proposal.id, "reject")}
                        >
                          <X /> {t("aiApprovals.reject")}
                        </Button>
                        <Button size="sm" disabled={isBusy} onClick={() => void act(proposal.id, "approve")}>
                          {isBusy ? <Loader2 className="animate-spin" /> : <Check />}
                          {t("aiApprovals.approve")}
                        </Button>
                      </>
                    ) : null}
                    {proposal.status === "approved" ? (
                      <Button size="sm" disabled={isBusy} onClick={() => void act(proposal.id, "apply")}>
                        {isBusy ? <Loader2 className="animate-spin" /> : <Check />}
                        {t("aiApprovals.apply")}
                      </Button>
                    ) : null}
                    {proposal.status === "applied" && proposal.rollbackable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => void act(proposal.id, "rollback")}
                      >
                        {isBusy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                        {t("aiApprovals.rollback")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

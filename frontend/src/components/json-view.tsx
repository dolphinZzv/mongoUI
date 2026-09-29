import { CheckIcon, CopyIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { copyToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { prettyJSON } from "@/lib/mongo"

interface JsonViewProps {
  value: unknown
  className?: string
  maxHeight?: string
}

export function JsonView({ value, className, maxHeight = "28rem" }: JsonViewProps) {
  const { t } = useI18n()
  const [copied, setCopied] = React.useState(false)
  const text = React.useMemo(() => (typeof value === "string" ? value : prettyJSON(value)), [value])

  const copy = async () => {
    const ok = await copyToClipboard(text)
    if (!ok) {
      toast.error(t("common.copyFailed"))
      return
    }
    setCopied(true)
    toast.success(t("common.copied"))
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={cn("bg-muted/40 relative overflow-hidden rounded-lg border", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        className="absolute top-2 right-2 z-10"
        title={t("common.copyJson")}
      >
        {copied ? <CheckIcon className="text-emerald-600 dark:text-emerald-400" /> : <CopyIcon />}
      </Button>
      <pre
        className="scrollbar-thin overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap"
        style={{ maxHeight }}
      >
        {text}
      </pre>
    </div>
  )
}

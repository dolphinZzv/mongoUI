import { Activity, BarChart3, Braces, Code2, Copy, Download, Ellipsis, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/lib/i18n"

interface DocumentsMoreMenuProps {
  readOnly: boolean
  hasDocuments: boolean
  onImport: () => void
  onExport: () => void
  onExplain: () => void
  onCopyCollection: () => void
  onChart: () => void
  onCopyMongo: () => void
  onCopySql: () => void
}

/** The overflow menu of secondary document actions. */
export function DocumentsMoreMenu({
  readOnly,
  hasDocuments,
  onImport,
  onExport,
  onExplain,
  onCopyCollection,
  onChart,
  onCopyMongo,
  onCopySql,
}: DocumentsMoreMenuProps) {
  const { t } = useI18n()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" title={t("docs.more")} aria-label={t("docs.more")}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem disabled={readOnly} onSelect={onImport}>
          <Upload /> {t("transfer.importAction")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExport}>
          <Download /> {t("transfer.exportAction")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onExplain}>
          <Activity /> {t("explain.title")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={readOnly} onSelect={onCopyCollection}>
          <Copy /> {t("copy.action")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasDocuments} onSelect={onChart}>
          <BarChart3 /> {t("chart.open")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCopyMongo}>
          <Braces /> {t("docs.copyMongo")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopySql}>
          <Code2 /> {t("docs.copySql")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import {
  AlertTriangle,
  Bookmark,
  Copy,
  Crop,
  Download,
  Loader2,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Share2,
  Sparkles,
  SlidersHorizontal,
  Table2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
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
import { useI18n } from "@/lib/i18n"
import type { ChartConfig } from "@/lib/chart"
import { cn } from "@/lib/utils"

export interface ChartToolbarProps {
  compact: boolean
  isFullscreen: boolean
  loading: boolean
  serverMode: boolean
  config: ChartConfig
  update: (patch: Partial<ChartConfig>) => void
  showTable: boolean
  configOpen: boolean
  alertTriggered: boolean
  lastUpdated: number | null
  temporalX: boolean
  scatterMode: boolean
  brushMode: boolean
  zoomed: boolean
  categoryCount: number
  rawTotal: number | null
  crowded: boolean
  downsampled: boolean
  error: string | null
  errorHint: string | null
  viewsEnabled: boolean
  onRefresh: () => void
  onRecommend: () => void
  onReset: () => void
  onShare?: (config: ChartConfig) => void
  onOpenViews: () => void
  onCopyCSV: () => void
  onDownloadCSV: () => void
  onCopyJSON: () => void
  onExportSVG: () => void
  onExportPNG: () => void
  onToggleTable: () => void
  onApplyFilter?: () => void
  onToggleConfig: () => void
  onToggleFullscreen: () => void
  onToggleBrush: () => void
  onResetZoom: () => void
}

export function ChartToolbar({
  compact,
  isFullscreen,
  loading,
  serverMode,
  config,
  update,
  showTable,
  configOpen,
  alertTriggered,
  lastUpdated,
  temporalX,
  scatterMode,
  brushMode,
  zoomed,
  categoryCount,
  rawTotal,
  crowded,
  downsampled,
  error,
  errorHint,
  viewsEnabled,
  onRefresh,
  onRecommend,
  onReset,
  onShare,
  onOpenViews,
  onCopyCSV,
  onDownloadCSV,
  onCopyJSON,
  onExportSVG,
  onExportPNG,
  onToggleTable,
  onApplyFilter,
  onToggleConfig,
  onToggleFullscreen,
  onToggleBrush,
  onResetZoom,
}: ChartToolbarProps) {
  const { t, locale } = useI18n()
  return (
      <div
        className={cn(
          "mb-2 flex flex-wrap items-center gap-2 text-[11px]",
          (compact || isFullscreen) && "hidden",
        )}
      >
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRefresh()}
          disabled={loading || !serverMode}
          title={t("common.refresh")}
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
          <span className="hidden sm:inline">{t("common.refresh")}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRecommend}
          title={t("chart.recommend")}
        >
          <Sparkles />
          <span className="hidden lg:inline">{t("chart.recommend")}</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onReset} title={t("chart.reset")}>
          <RotateCcw />
          <span className="hidden sm:inline">{t("chart.reset")}</span>
        </Button>
        {onShare ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onShare(config)}
            title={t("chart.copyLink")}
          >
            <Share2 />
            <span className="hidden lg:inline">{t("chart.copyLink")}</span>
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenViews()}
          title={t("chart.views")}
          disabled={!viewsEnabled}
        >
          <Bookmark />
          <span className="hidden lg:inline">{t("chart.views")}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" title={t("chart.export")}>
              <Download />
              <span className="hidden sm:inline">{t("chart.export")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => onCopyCSV()}>
              <Copy /> {t("chart.copyCSV")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDownloadCSV}>
              <Download /> {t("chart.downloadCSV")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onCopyJSON()}>
              <Copy /> {t("chart.copyJSON")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onExportSVG}>
              <Download /> {t("chart.downloadSVG")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExportPNG()}>
              <Download /> {t("chart.downloadPNG")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant={showTable ? "secondary" : "outline"}
          size="sm"
          onClick={() => onToggleTable()}
          title={t("chart.dataTable")}
        >
          <Table2 />
        </Button>
        {onApplyFilter ? (
          <Button variant="outline" size="sm" onClick={onApplyFilter}>
            {t("chart.applyToDocuments")}
          </Button>
        ) : null}
      </div>

        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5">
          {serverMode ? t("chart.serverData") : t("chart.pageData")}
        </span>
        <Select
          value={String(config.refreshInterval)}
          onValueChange={(value) => update({ refreshInterval: Number(value) })}
        >
          <SelectTrigger size="sm" className="h-6 w-24 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">{t("chart.refreshOff")}</SelectItem>
            <SelectItem value="5">5s</SelectItem>
            <SelectItem value="10">10s</SelectItem>
            <SelectItem value="30">30s</SelectItem>
            <SelectItem value="60">1m</SelectItem>
            <SelectItem value="300">5m</SelectItem>
          </SelectContent>
        </Select>
        {config.refreshInterval > 0 ? (
          <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            {t("chart.live")}
          </span>
        ) : null}
        {alertTriggered ? (
          <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
            {t("chart.alert")}
          </span>
        ) : null}
        {lastUpdated ? (
          <span className="text-muted-foreground">
            {t("chart.lastUpdated", {
              time: new Date(lastUpdated).toLocaleTimeString(
                locale === "zh" ? "zh-CN" : "en-US",
              ),
            })}
          </span>
        ) : null}
        <Button
          variant={configOpen ? "secondary" : "outline"}
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => onToggleConfig()}
        >
          <SlidersHorizontal className="size-3" /> {t("chart.configure")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={onToggleFullscreen}
          title={t("chart.fullscreen")}
        >
          <Maximize2 className="size-3" />
        </Button>
        {temporalX && !scatterMode ? (
          <Button
            variant={brushMode ? "secondary" : "outline"}
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={onToggleBrush}
            title={t("chart.brush")}
          >
            <Crop className="size-3" /> {t("chart.brush")}
          </Button>
        ) : null}
        {zoomed ? (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={onResetZoom}
          >
            {t("chart.resetZoom")}
          </Button>
        ) : null}
        {brushMode ? (
          <span className="text-muted-foreground">{t("chart.brushHint")}</span>
        ) : null}
        {config.aggregate === "none" && serverMode ? (
          <span className="text-muted-foreground">
            {t("chart.rawHint", {
              shown: categoryCount,
              total: rawTotal ?? categoryCount,
            })}
          </span>
        ) : null}
        {config.aggregate === "none" && serverMode ? (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => update({ limit: Math.min(Math.max(config.limit * 2, 40), 500) })}
          >
            {t("chart.showMore")}
          </Button>
        ) : null}
        {config.aggregate === "none" && serverMode ? (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => update({ aggregate: config.y.length > 0 ? "sum" : "count" })}
          >
            {t("chart.useAggregate")}
          </Button>
        ) : null}
        {crowded ? (
          <span className="text-muted-foreground flex flex-wrap items-center gap-1">
            <AlertTriangle className="size-3 text-amber-500" />
            {t("chart.crowded")}
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => update({ others: true })}
            >
              {t("chart.mergeOthers")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => update({ type: "hbar" })}
            >
              {t("chart.type.hbar")}
            </Button>
          </span>
        ) : null}
        {downsampled ? (
          <span className="text-muted-foreground">
            {t("chart.downsampled", { shown: categoryCount })}
          </span>
        ) : null}
        {loading ? (
          <span className="text-muted-foreground flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> {t("common.loading")}
          </span>
        ) : null}
        {error ? (
          <span className="text-destructive flex flex-wrap items-center gap-2">
            <span className="max-w-[32rem] truncate" title={error}>
              {error}
            </span>
            {errorHint ? (
              <span className="text-muted-foreground">· {errorHint}</span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => onRefresh()}
            >
              {t("common.retry")}
            </Button>
          </span>
        ) : null}
      </div>
  )
}

import * as React from "react"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { QueryDuration } from "@/components/query-duration"
import { useI18n } from "@/lib/i18n"

interface DocumentsPaginationProps {
  total: number
  skip: number
  limit: number
  durationMs?: number
  page: number
  pages: number
  loading: boolean
  readOnly: boolean
  onLimitChange: (limit: number) => void
  onPrev: () => void
  onNext: () => void
  /** Jump to a 1-based page; used by the first/last buttons and the page input. */
  onGoToPage: (page: number) => void
  onDeleteMatching: () => void
}

const PAGE_SIZES = [25, 50, 100, 250]

export function DocumentsPagination({
  total,
  skip,
  limit,
  durationMs,
  page,
  pages,
  loading,
  readOnly,
  onLimitChange,
  onPrev,
  onNext,
  onGoToPage,
  onDeleteMatching,
}: DocumentsPaginationProps) {
  const { t } = useI18n()
  const [jump, setJump] = React.useState("")

  const goToPage = (value: string) => {
    const next = Number.parseInt(value, 10)
    if (!Number.isFinite(next) || pages <= 0) return
    onGoToPage(Math.min(Math.max(next, 1), pages))
    setJump("")
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t px-3 py-2 text-sm">
      <span className="text-muted-foreground">
        {total === 0
          ? "0"
          : t("docs.rangeOf", {
              from: skip + 1,
              to: Math.min(skip + limit, total),
              total,
            })}
      </span>
      <QueryDuration ms={durationMs} />
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">{t("docs.pageSize")}</span>
        <Select value={String(limit)} onValueChange={(value) => onLimitChange(Number(value))}>
          <SelectTrigger size="sm" className="w-[72px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
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
          disabled={page <= 1 || loading}
          onClick={() => onGoToPage(1)}
          title={t("docs.firstPage")}
          aria-label={t("docs.firstPage")}
        >
          <ChevronsLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={skip <= 0 || loading}
          onClick={onPrev}
          title={t("docs.prevPage")}
          aria-label={t("docs.prevPage")}
        >
          <ChevronLeft />
        </Button>
        <span className="text-muted-foreground px-2 text-xs">{t("docs.page", { page, pages })}</span>
        <Input
          value={jump}
          onChange={(event) => setJump(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              goToPage(jump)
            }
          }}
          onBlur={() => (jump ? goToPage(jump) : undefined)}
          placeholder={String(page)}
          inputMode="numeric"
          aria-label={t("docs.jumpToPage")}
          className="h-7 w-12 px-1 text-center text-xs"
        />
        <Button
          variant="outline"
          size="icon-sm"
          disabled={skip + limit >= total || loading}
          onClick={onNext}
          title={t("docs.nextPage")}
          aria-label={t("docs.nextPage")}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page >= pages || loading || pages <= 0}
          onClick={() => onGoToPage(pages)}
          title={t("docs.lastPage")}
          aria-label={t("docs.lastPage")}
        >
          <ChevronsRight />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={readOnly} aria-label={t("docs.deleteMatching")}>
              <Trash2 />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem variant="destructive" onSelect={onDeleteMatching}>
              <Trash2 /> {t("docs.deleteMatching")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

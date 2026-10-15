import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import { useI18n } from "@/lib/i18n"

interface DocumentsPaginationProps {
  total: number
  skip: number
  limit: number
  page: number
  pages: number
  loading: boolean
  readOnly: boolean
  onLimitChange: (limit: number) => void
  onPrev: () => void
  onNext: () => void
  onDeleteMatching: () => void
}

const PAGE_SIZES = [25, 50, 100, 250]

export function DocumentsPagination({
  total,
  skip,
  limit,
  page,
  pages,
  loading,
  readOnly,
  onLimitChange,
  onPrev,
  onNext,
  onDeleteMatching,
}: DocumentsPaginationProps) {
  const { t } = useI18n()

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t px-3 py-2 text-sm">
      <span className="text-muted-foreground">
        {total === 0 ? "0" : `${skip + 1}–${Math.min(skip + limit, total)}`} of {total}
      </span>
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
          disabled={skip <= 0 || loading}
          onClick={onPrev}
          aria-label={t("docs.prevPage")}
        >
          <ChevronLeft />
        </Button>
        <span className="text-muted-foreground px-2 text-xs">{t("docs.page", { page, pages })}</span>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={skip + limit >= total || loading}
          onClick={onNext}
          aria-label={t("docs.nextPage")}
        >
          <ChevronRight />
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

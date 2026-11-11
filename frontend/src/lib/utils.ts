import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a query duration in a compact, human-readable form. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—"
  if (ms === 0) return "0 ms"
  if (ms < 1) return "<1 ms"
  if (ms < 10) return `${ms.toFixed(1)} ms`
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} h`
  return `${(ms / 86_400_000).toFixed(1)} d`
}

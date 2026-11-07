import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a query duration in a compact, human-readable form. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—"
  if (ms < 1) return "<1 ms"
  if (ms < 10) return `${ms.toFixed(1)} ms`
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

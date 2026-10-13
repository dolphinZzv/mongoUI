import * as React from "react"

/**
 * Defers rendering (and therefore loading the chunk of) a React.lazy child
 * until `active` first becomes true. The child stays mounted afterwards so
 * Radix overlays can still play their exit animation.
 */
export function LazyMount({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  const [seen, setSeen] = React.useState(active)
  React.useEffect(() => {
    if (active) setSeen(true)
  }, [active])
  if (!seen) return null
  return <React.Suspense fallback={null}>{children}</React.Suspense>
}

/** A lightweight centered spinner used as a Suspense fallback. */
export function TabFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="border-muted-foreground/40 border-t-foreground size-5 animate-spin rounded-full border-2" />
    </div>
  )
}

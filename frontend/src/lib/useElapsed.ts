import * as React from "react"

/**
 * Ticks once per second while `active` is true, returning the elapsed seconds
 * since it became active. Resets to 0 when it turns off. Useful for giving
 * long-running requests a visible "it is still working" signal.
 */
export function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = React.useState(0)

  React.useEffect(() => {
    if (!active) {
      setSeconds(0)
      return
    }
    const startedAt = Date.now()
    setSeconds(0)
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [active])

  return seconds
}

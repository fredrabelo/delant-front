/**
 * Chart color tokens, read from the same CSS custom properties the rest of
 * the UI uses (tailwind.config.js maps `--primary`/`--muted-foreground`/etc.
 * as `hsl(var(--x))`), so charts stay visually consistent with the design
 * system instead of hardcoding hex values. Falls back to fixed HSL triplets
 * during SSR (no `document` yet) or if a token isn't set.
 */
const FALLBACK: Record<string, string> = {
  '--primary': '241 98% 58%',
  '--muted-foreground': '0 0% 40%',
  '--destructive': '352 70% 49%',
  '--border': '0 0% 89%',
}

function cssVar(name: string): string {
  if (import.meta.client) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (v) return v
  }
  return FALLBACK[name] ?? '215 16% 47%'
}

/**
 * A fixed, colorblind-conscious categorical sequence for multi-series charts.
 * Anchored on the brand blue (#312CFD) so a single-series chart reads as part
 * of the same system, then stepped around the wheel for separation.
 */
const CATEGORICAL_HUES = [241, 187, 30, 158, 280, 352, 45, 205]

export function useChartColors() {
  const hsl = (triplet: string, alpha = 1) => `hsl(${triplet} / ${alpha})`

  const primary = hsl(cssVar('--primary'))
  const mutedForeground = hsl(cssVar('--muted-foreground'))
  const destructive = hsl(cssVar('--destructive'))
  const border = hsl(cssVar('--border'))

  /** `n` distinct categorical colors, stable across renders. */
  function categorical(n: number, alpha = 0.85): string[] {
    return Array.from({ length: n }, (_, i) => {
      const hue = CATEGORICAL_HUES[i % CATEGORICAL_HUES.length]
      return `hsl(${hue} 65% 50% / ${alpha})`
    })
  }

  return { primary, mutedForeground, destructive, border, categorical }
}

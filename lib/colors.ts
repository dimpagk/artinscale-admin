/**
 * Color utilities — palette manipulation + perceptual naming.
 *
 * Designed to be small and dependency-free so they can run
 * server-side (route handlers) and in client components alike.
 */

// ============================================
// Hex / HSL conversion
// ============================================

/**
 * Normalize a fill string into a 6-digit lowercase hex if possible.
 * Supports `#rgb`, `#rrggbb`, and `rgb(r, g, b)`. Returns null if
 * the input doesn't parse — callers can fall back to the original
 * string.
 */
export function normalizeColor(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return (
      '#' +
      trimmed
        .slice(1)
        .split('')
        .map((c) => c + c)
        .join('')
    )
  }
  const rgbMatch = trimmed.match(/^rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)$/)
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch
    return (
      '#' +
      [r, g, b]
        .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0'))
        .join('')
    )
  }
  return null
}

/**
 * Convert a 6-digit hex to HSL (h: 0..360, s/l: 0..1).
 * Returns null for malformed inputs.
 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h *= 60
  }
  return { h, s, l }
}

/**
 * Convert HSL (h: 0..360, s/l: 0..1) back to 6-digit hex (lowercase).
 */
export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r1 = 0
  let g1 = 0
  let b1 = 0
  if (h < 60) [r1, g1, b1] = [c, x, 0]
  else if (h < 120) [r1, g1, b1] = [x, c, 0]
  else if (h < 180) [r1, g1, b1] = [0, c, x]
  else if (h < 240) [r1, g1, b1] = [0, x, c]
  else if (h < 300) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`
}

// ============================================
// Palette manipulation
// ============================================

/**
 * Rotate every hex color in `palette` by `degrees` on the HSL hue axis.
 * Used for variant generation ("warm shift", "cool shift") in the
 * vector pipeline.
 */
export function rotateHues(palette: string[], degrees: number): string[] {
  return palette.map((hex) => {
    const hsl = hexToHsl(hex)
    if (!hsl) return hex
    const newHue = (hsl.h + degrees + 360) % 360
    return hslToHex(newHue, hsl.s, hsl.l)
  })
}

// ============================================
// Naming
// ============================================

/**
 * Strip the leading `#` and uppercase. Used for tooltips / fallbacks
 * where the raw hex value is the most honest label.
 */
export function hexToName(hex: string): string {
  return hex.toUpperCase().replace(/^#/, '')
}

/**
 * Perceptual auto-name for a hex color — produces labels like
 * "Warm red", "Cool blue", "Light grey", "Dark cyan", etc. Better
 * than raw hex for the layers panel.
 *
 * Rules (rough but good enough):
 *   - Saturation < 12% → grayscale (light/mid/dark grey)
 *   - Lightness < 25% → "Dark <hue>"; > 78% → "Light <hue>"
 *   - Otherwise: optional Vivid / Muted qualifier on saturated colors
 *   - Hue → bucketed: red, orange, amber, yellow, lime, green, teal,
 *     cyan, blue, indigo, violet, magenta, pink
 */
export function autoNameForColor(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase().replace(/^#/, '')
  const hsl = hexToHsl(hex)
  if (!hsl) return hexToName(hex)
  const { h, s, l } = hsl

  // Grayscale path
  if (s < 0.12) {
    if (l < 0.2) return 'Near black'
    if (l < 0.4) return 'Dark grey'
    if (l < 0.6) return 'Mid grey'
    if (l < 0.85) return 'Light grey'
    return 'Near white'
  }

  // Hue bucket
  const buckets: Array<[number, string]> = [
    [15, 'red'],
    [35, 'orange'],
    [50, 'amber'],
    [65, 'yellow'],
    [85, 'lime'],
    [160, 'green'],
    [185, 'teal'],
    [205, 'cyan'],
    [240, 'blue'],
    [275, 'indigo'],
    [295, 'violet'],
    [325, 'magenta'],
    [350, 'pink'],
    [360, 'red'],
  ]
  let hue = 'red'
  for (const [edge, name] of buckets) {
    if (h <= edge) {
      hue = name
      break
    }
  }

  let qualifier = ''
  if (l < 0.25) qualifier = 'Dark '
  else if (l > 0.78) qualifier = 'Light '
  else if (s > 0.7) qualifier = 'Vivid '
  else if (s < 0.35) qualifier = 'Muted '

  const cap = (str: string) => str.charAt(0).toUpperCase() + str.slice(1)
  return qualifier ? `${qualifier}${hue}` : cap(hue)
}

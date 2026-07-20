// Artist-first registry of the studio's deterministic drawing systems.
//
// Each system lives in the workspace repo under generative/<id>/ as a
// self-contained folder: viewer.html (the browser studio), node/render.js
// (the headless renderer the admin shells out to) and node/system.js (the
// algorithm, kept in stroke-for-stroke parity with the viewer). The admin
// never re-implements a system; it only drives the CLI. Registering a new
// system here is the only admin-side step it needs.
//
// Param specs mirror each render.js styleParams() flag list. A value equal
// to `def` (or the 'auto' sentinel on selects) is NOT passed to the CLI, so
// untouched controls always yield the pack's canonical output.

export type GenerativeParam =
  | {
      key: string
      label: string
      kind: 'number'
      def: number
      min: number
      max: number
      step: number
    }
  | { key: string; label: string; kind: 'select'; def: string; options: string[] }

export interface GenerativeSystem {
  /** Folder name under the generative root; also the URL segment. */
  id: string
  title: string
  /** Position in the artist's catalogue, e.g. 'Second series'. */
  series: string
  tagline: string
  params: GenerativeParam[]
}

export interface GenerativeArtist {
  /** Short studio code matching the seeded persona UUIDs (a10, a11, ...). */
  code: string
  name: string
  systems: GenerativeSystem[]
}

const pct = (key: string, label: string, def: number): GenerativeParam => ({
  key,
  label,
  kind: 'number',
  def,
  min: 0,
  max: 1,
  step: 0.05,
})

export const GENERATIVE_ARTISTS: GenerativeArtist[] = [
  {
    code: 'a10',
    name: 'Emil Varga',
    systems: [
      {
        id: 'field-notation',
        title: 'Field Notation',
        series: 'First series',
        tagline:
          'Thousands of fine ink strands flow around one reserved empty shape.',
        params: [
          { key: 'strands', label: 'Strands', kind: 'number', def: 2200, min: 400, max: 4000, step: 100 },
          { key: 'fieldScale', label: 'Field scale', kind: 'number', def: 3, min: 1, max: 6, step: 0.1 },
          { key: 'turbulence', label: 'Turbulence', kind: 'number', def: 0.95, min: 0, max: 2, step: 0.05 },
          pct('calm', 'Calm', 0.5),
          pct('accentPresence', 'Accent presence', 0.65),
          { key: 'lineWeight', label: 'Line weight', kind: 'number', def: 1, min: 0.5, max: 2, step: 0.05 },
        ],
      },
      {
        id: 'isarithm',
        title: 'Isarithm',
        series: 'Second series',
        tagline: 'A contour survey of terrain that does not exist.',
        params: [
          {
            key: 'voice',
            label: 'Ink voice',
            kind: 'select',
            def: 'auto',
            options: ['auto', 'CARBON', 'SEPIA', 'INDIGO', 'SPRUCE', 'MADDER'],
          },
          { key: 'contours', label: 'Contours', kind: 'number', def: 34, min: 8, max: 80, step: 1 },
          { key: 'terrainScale', label: 'Terrain scale', kind: 'number', def: 2.6, min: 1, max: 6, step: 0.1 },
          pct('shear', 'Shear', 0.5),
          pct('sea', 'Sea level', 0.5),
          pct('accentPresence', 'Accent presence', 0.85),
          { key: 'lineWeight', label: 'Line weight', kind: 'number', def: 1, min: 0.5, max: 2, step: 0.05 },
        ],
      },
      {
        id: 'occultation',
        title: 'Occultation',
        series: 'Third series',
        tagline: 'A census of a sky that does not exist; the void is the subject.',
        params: [
          {
            key: 'voice',
            label: 'Ink voice',
            kind: 'select',
            def: 'auto',
            options: ['auto', 'CARBON', 'INDIGO', 'SEPIA', 'SLATE', 'UMBER'],
          },
          { key: 'census', label: 'Census', kind: 'number', def: 20000, min: 4000, max: 40000, step: 500 },
          pct('band', 'Band', 0.55),
          pct('cluster', 'Cluster', 0.55),
          pct('occult', 'Occult', 0.6),
          pct('accentPresence', 'Accent presence', 0.85),
          { key: 'dotScale', label: 'Dot scale', kind: 'number', def: 1, min: 0.5, max: 2, step: 0.05 },
        ],
      },
    ],
  },
  {
    code: 'a11',
    name: 'Klara Steinmetz',
    systems: [
      {
        id: 'solid-state',
        title: 'Solid State',
        series: 'First series',
        tagline:
          'A constructivist bar dissolves into line and folds down the plate as a moiré ribbon.',
        params: [
          {
            key: 'palette',
            label: 'Palette',
            kind: 'select',
            def: 'auto',
            options: ['auto', 'kasein', 'nacht', 'graphit', 'salz', 'smaragd', 'rost'],
          },
          { key: 'lines', label: 'Lines', kind: 'number', def: 64, min: 24, max: 160, step: 2 },
          { key: 'twist', label: 'Twist', kind: 'number', def: 0.9, min: 0, max: 2, step: 0.05 },
          { key: 'sweep', label: 'Sweep', kind: 'number', def: 1, min: 0, max: 2, step: 0.05 },
          { key: 'barWidth', label: 'Bar width', kind: 'number', def: 1, min: 0.5, max: 2, step: 0.05 },
          pct('accentPresence', 'Accent presence', 0.85),
          { key: 'lineWeight', label: 'Line weight', kind: 'number', def: 1, min: 0.5, max: 2, step: 0.05 },
        ],
      },
      {
        id: 'warp',
        title: 'Warp',
        series: 'Second series',
        tagline:
          'A woven mesh of warp and weft hairlines stretched over a seeded form.',
        params: [
          {
            key: 'palette',
            label: 'Palette',
            kind: 'select',
            def: 'auto',
            options: ['auto', 'eisrosa', 'erdbeer', 'tinte', 'spektrum', 'nachtgarn', 'moor', 'holz'],
          },
          { key: 'threads', label: 'Threads', kind: 'number', def: 1, min: 0.5, max: 2, step: 0.05 },
          { key: 'drape', label: 'Drape', kind: 'number', def: 1, min: 0, max: 2, step: 0.05 },
          { key: 'ripple', label: 'Ripple', kind: 'number', def: 1, min: 0, max: 2, step: 0.05 },
          { key: 'lineWeight', label: 'Line weight', kind: 'number', def: 1, min: 0.5, max: 2, step: 0.05 },
        ],
      },
    ],
  },
]

export function findSystem(
  id: string
): { artist: GenerativeArtist; system: GenerativeSystem } | null {
  for (const artist of GENERATIVE_ARTISTS) {
    const system = artist.systems.find((s) => s.id === id)
    if (system) return { artist, system }
  }
  return null
}

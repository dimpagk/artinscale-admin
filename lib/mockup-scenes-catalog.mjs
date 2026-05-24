/**
 * Plain-JS source of truth for the mockup-scene catalog.
 *
 * The TS module `lib/mockup-scenes.ts` re-exports from here so the
 * one-time generator script (`scripts/generate-mockup-scenes.mjs`) can
 * read the same data without parsing TypeScript.
 */

export const SCENE_PROMPT_BASE =
  'Editorial interior photograph, daylight, no people, soft natural shadows, ' +
  'clean composition, the focal wall is empty and unbroken (no existing artwork), ' +
  'realistic proportions and scale, modern interior magazine style, sharp focus.';

export const MOCKUP_SCENES = [
  // ── Office (4)
  {
    key: 'office-minimal-desk',
    room: 'office',
    aesthetic: 'minimal',
    aspectRatio: '4:3',
    wallTarget: { x: 0.42, y: 0.12, w: 0.28, h: 0.45 },
    prompt:
      `${SCENE_PROMPT_BASE} A minimal home office: light oak desk, single black task chair, brass clip lamp, ` +
      'small ceramic vase, neutral linen curtains in soft focus. Wall behind the desk is matte off-white plaster, completely bare.',
  },
  {
    key: 'office-warm-bookshelf',
    room: 'office',
    aesthetic: 'warm',
    aspectRatio: '4:3',
    wallTarget: { x: 0.55, y: 0.15, w: 0.3, h: 0.5 },
    prompt:
      `${SCENE_PROMPT_BASE} A warm-toned office reading corner: walnut bookshelf to one side, leather club chair, ` +
      'rust wool throw, brass floor lamp. The wall above the chair is painted clay beige, fully empty.',
  },
  {
    key: 'office-industrial-loft',
    room: 'office',
    aesthetic: 'industrial',
    aspectRatio: '3:2',
    wallTarget: { x: 0.4, y: 0.1, w: 0.3, h: 0.5 },
    prompt:
      `${SCENE_PROMPT_BASE} An industrial loft workspace: steel-framed desk, wide windows in soft focus, ` +
      'concrete floor, single Anglepoise lamp, exposed white brick wall behind the desk that is completely bare.',
  },
  {
    key: 'office-scandi-corner',
    room: 'office',
    aesthetic: 'scandinavian',
    aspectRatio: '4:3',
    wallTarget: { x: 0.45, y: 0.1, w: 0.25, h: 0.5 },
    prompt:
      `${SCENE_PROMPT_BASE} A Scandinavian-style desk corner: pale ash desk, light gray felt chair, single white ` +
      'paper pendant, small olive plant. Wall is bright white plaster, completely empty.',
  },

  // ── Bedroom (3)
  {
    key: 'bedroom-minimal-headboard',
    room: 'bedroom',
    aesthetic: 'minimal',
    aspectRatio: '3:2',
    wallTarget: { x: 0.3, y: 0.05, w: 0.4, h: 0.4 },
    prompt:
      `${SCENE_PROMPT_BASE} A minimal bedroom: low-profile platform bed centered, white linen bedding, ` +
      'matching nightstands with small ceramic lamps, warm oak floor. The wall above the headboard is broad, bare, and matte off-white.',
  },
  {
    key: 'bedroom-warm-headboard',
    room: 'bedroom',
    aesthetic: 'warm',
    aspectRatio: '3:2',
    wallTarget: { x: 0.3, y: 0.05, w: 0.4, h: 0.4 },
    prompt:
      `${SCENE_PROMPT_BASE} A warm bedroom: walnut headboard, ivory bedding with terracotta throw, ` +
      'twin nightstands with brass lamps, oak floor with cream rug. The wall above is painted soft warm white, completely empty.',
  },
  {
    key: 'bedroom-midcentury-dresser',
    room: 'bedroom',
    aesthetic: 'mid-century',
    aspectRatio: '4:3',
    wallTarget: { x: 0.35, y: 0.08, w: 0.3, h: 0.5 },
    prompt:
      `${SCENE_PROMPT_BASE} A mid-century bedroom corner with a low teak dresser, brass pulls, ceramic table lamp, ` +
      'small folded blanket. The wall behind the dresser is painted muted sage, completely empty.',
  },

  // ── Living room (3)
  {
    key: 'living-minimal-sofa',
    room: 'living-room',
    aesthetic: 'minimal',
    aspectRatio: '3:2',
    wallTarget: { x: 0.3, y: 0.05, w: 0.4, h: 0.5 },
    prompt:
      `${SCENE_PROMPT_BASE} A minimal living room: long low cream linen sofa, simple oak coffee table, ` +
      'small marble side table with a candle. Wall above the sofa is large, smooth, painted matte off-white, completely empty.',
  },
  {
    key: 'living-warm-sofa',
    room: 'living-room',
    aesthetic: 'warm',
    aspectRatio: '3:2',
    wallTarget: { x: 0.3, y: 0.05, w: 0.4, h: 0.5 },
    prompt:
      `${SCENE_PROMPT_BASE} A warm living room: deep rust velvet sofa, walnut coffee table, brass arc lamp, ` +
      'wool rug with subtle pattern. The wall above the sofa is broad, painted soft cream, completely empty.',
  },
  {
    key: 'living-scandi-sofa',
    room: 'living-room',
    aesthetic: 'scandinavian',
    aspectRatio: '3:2',
    wallTarget: { x: 0.3, y: 0.05, w: 0.4, h: 0.5 },
    prompt:
      `${SCENE_PROMPT_BASE} A Scandinavian living room: pale gray fabric sofa, white-oak coffee table, sheepskin throw, ` +
      'simple ceramic vase with greenery. Wall is bright white plaster, completely empty.',
  },

  // ── Dining room (2)
  {
    key: 'dining-warm-table',
    room: 'dining-room',
    aesthetic: 'warm',
    aspectRatio: '3:2',
    wallTarget: { x: 0.32, y: 0.08, w: 0.36, h: 0.5 },
    prompt:
      `${SCENE_PROMPT_BASE} A warm dining setup: oak dining table set for four, woven rattan chairs, ` +
      'ceramic vase with wildflowers, hanging linen pendant in soft focus. Wall behind the table is matte clay-beige plaster, completely empty.',
  },
  {
    key: 'dining-minimal-table',
    room: 'dining-room',
    aesthetic: 'minimal',
    aspectRatio: '3:2',
    wallTarget: { x: 0.3, y: 0.08, w: 0.4, h: 0.5 },
    prompt:
      `${SCENE_PROMPT_BASE} A minimalist dining nook: pale stone-top table, four black wishbone chairs, ` +
      'single bone-china vase. Wall behind the table is broad, painted bright white, completely empty.',
  },

  // ── Hallway (3)
  {
    key: 'hallway-minimal-console',
    room: 'hallway',
    aesthetic: 'minimal',
    aspectRatio: '4:3',
    wallTarget: { x: 0.32, y: 0.08, w: 0.36, h: 0.55 },
    prompt:
      `${SCENE_PROMPT_BASE} A minimal entryway hallway: thin oak console table, single ceramic vessel, ` +
      'small linen runner on a pale stone floor. The long wall above the console is empty, matte off-white plaster.',
  },
  {
    key: 'hallway-warm-runner',
    room: 'hallway',
    aesthetic: 'warm',
    aspectRatio: '16:9',
    wallTarget: { x: 0.2, y: 0.18, w: 0.6, h: 0.5 },
    prompt:
      `${SCENE_PROMPT_BASE} A warm hallway with patterned runner rug, two wall sconces in brass, ` +
      'oak floorboards. The long side wall stretches into the distance and is completely empty, painted soft warm white. ' +
      'Camera angle shows the wall in receding perspective so a series of artworks can be placed along it.',
  },
  {
    key: 'hallway-scandi-stairs',
    room: 'hallway',
    aesthetic: 'scandinavian',
    aspectRatio: '3:2',
    wallTarget: { x: 0.35, y: 0.1, w: 0.3, h: 0.55 },
    prompt:
      `${SCENE_PROMPT_BASE} A Scandinavian stair landing: pale wood floor, white oak banister, ` +
      'small bench with a folded throw. The tall wall is bright white plaster, completely empty.',
  },
];

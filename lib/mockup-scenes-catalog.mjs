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
  'realistic proportions and scale, modern interior magazine style, sharp focus, ' +
  'eye-level camera with a natural 35mm perspective, natural color grading, no text, ' +
  'no artwork, mirrors, shelves, or fixtures on the focal wall.';

// Default art-placement boxes per room type, taken from the tuned
// generic scenes below. Individual scenes can override after review.
const WALL_TARGET_DEFAULTS = {
  office: { x: 0.42, y: 0.12, w: 0.28, h: 0.45 },
  bedroom: { x: 0.3, y: 0.05, w: 0.4, h: 0.4 },
  'living-room': { x: 0.3, y: 0.05, w: 0.4, h: 0.5 },
  'dining-room': { x: 0.3, y: 0.08, w: 0.4, h: 0.5 },
  hallway: { x: 0.32, y: 0.08, w: 0.36, h: 0.55 },
};

/**
 * Build a city-anchored scene from the standardized recipe so the whole
 * library reads as one photographer's portfolio. The city shows through
 * furniture, materials, floor, and light only: never landmarks, never a
 * view pasted on the wall.
 */
function cityScene({ key, room, aesthetic, city, code, desc, materials, light, wallTarget }) {
  return {
    key,
    room,
    aesthetic,
    // Living, bedroom, and dining read wider; office and hallway taller.
    aspectRatio: room === 'office' || room === 'hallway' ? '4:3' : '3:2',
    wallTarget: wallTarget ?? WALL_TARGET_DEFAULTS[room],
    location: { city, code },
    materials,
    light,
    prompt:
      `${SCENE_PROMPT_BASE} ${desc} ${light}. ` +
      'The focal wall is smooth, matte, and completely bare.',
  };
}

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

  // ── City library (60): 30 cities x 2 rooms. Location expressed
  // through furniture, materials, floor, and light only.

  // New York
  cityScene({
    key: 'ny-living-loft',
    room: 'living-room',
    aesthetic: 'industrial',
    city: 'New York',
    code: 'NY',
    desc:
      'A New York cast-iron loft living room: charcoal linen sofa, walnut coffee table, ' +
      'a black steel column to one side, white-painted brick side walls, wide oak plank floor, ' +
      'black steel window frames in soft focus. The focal wall is smooth white-painted brick.',
    materials: ['white-painted brick', 'oak planks', 'black steel', 'walnut'],
    light: 'Soft cool north daylight from tall industrial windows',
  }),
  cityScene({
    key: 'ny-office-prewar',
    room: 'office',
    aesthetic: 'classic',
    city: 'New York',
    code: 'NY',
    desc:
      'A Manhattan prewar study: mahogany desk, brass bankers lamp, a radiator below the ' +
      'window ledge, creamy plaster walls, dark herringbone parquet, painted trim.',
    materials: ['creamy plaster', 'herringbone parquet', 'mahogany', 'brass'],
    light: 'Warm afternoon side light through a sheer curtain',
  }),

  // Amsterdam
  cityScene({
    key: 'ams-living-canal',
    room: 'living-room',
    aesthetic: 'warm',
    city: 'Amsterdam',
    code: 'AMS',
    desc:
      'An Amsterdam canal-house living room: ochre velvet sofa, small antique side table, ' +
      'a tall sash window in soft focus, warm white plaster walls, wide old pine floorboards with visible grain.',
    materials: ['warm white plaster', 'old pine boards', 'velvet', 'antique wood'],
    light: 'Silvery Dutch overcast glow through tall windows',
  }),
  cityScene({
    key: 'ams-hallway-stairs',
    room: 'hallway',
    aesthetic: 'classic',
    city: 'Amsterdam',
    code: 'AMS',
    desc:
      'An Amsterdam canal-house stair hall: slim oak console, ceramic umbrella stand, narrow runner, ' +
      'painted wood paneling below, matte plaster above, worn pine treads rising at the edge of frame.',
    materials: ['painted paneling', 'matte plaster', 'worn pine', 'oak'],
    light: 'Cool daylight from a transom window above the door',
  }),

  // Athens
  cityScene({
    key: 'ath-bedroom-marble',
    room: 'bedroom',
    aesthetic: 'mediterranean',
    city: 'Athens',
    code: 'ATH',
    desc:
      'An Athenian apartment bedroom: low bed in crisp white linen, marble-top nightstand, ' +
      'small ceramic lamp, cool white marble floor, warm-white plaster walls.',
    materials: ['white marble floor', 'warm-white plaster', 'linen', 'ceramic'],
    light:
      'Bright Mediterranean light through half-closed shutters, the shutter stripes falling on the floor and kept off the focal wall',
  }),
  cityScene({
    key: 'ath-hallway-polykatoikia',
    room: 'hallway',
    aesthetic: 'mid-century',
    city: 'Athens',
    code: 'ATH',
    desc:
      'A 1960s Athens polykatoikia entry hall: teak console with a brass key bowl, ' +
      'speckled terrazzo floor, anthracite door frame in soft focus, plaster walls.',
    materials: ['terrazzo', 'plaster', 'teak', 'brass'],
    light: 'Bright diffuse stairwell light',
  }),

  // Patmos
  cityScene({
    key: 'pat-bedroom-whitewash',
    room: 'bedroom',
    aesthetic: 'mediterranean',
    city: 'Patmos',
    code: 'PAT',
    desc:
      'A whitewashed Greek island bedroom on Patmos: built-in masonry bed with linen bedding, ' +
      'a single wooden stool, thick whitewashed plaster with softly rounded corners, stone slab floor.',
    materials: ['thick whitewash', 'stone slabs', 'linen', 'rough wood'],
    light: 'Sea-bright morning light bouncing off the white walls',
  }),
  cityScene({
    key: 'pat-hallway-arch',
    room: 'hallway',
    aesthetic: 'mediterranean',
    city: 'Patmos',
    code: 'PAT',
    desc:
      'An arched island passage on Patmos: low wooden bench, woven basket, olive branch in a clay jug, ' +
      'whitewashed plaster, a dark timber lintel over a deep-set opening, flagstone floor.',
    materials: ['whitewashed plaster', 'flagstone', 'dark timber', 'clay'],
    light: 'Light from a deep-set window pooling on the floor',
  }),

  // Bali
  cityScene({
    key: 'bal-bedroom-teak',
    room: 'bedroom',
    aesthetic: 'tropical',
    city: 'Bali',
    code: 'BAL',
    desc:
      'A Balinese pavilion bedroom: low teak bed with a tied-back canopy net, rattan bench at its foot, ' +
      'limewashed walls, teak floor, woven pandan rug.',
    materials: ['limewash', 'teak', 'rattan', 'woven pandan'],
    light: 'Warm tropical light filtered through palms, dappled at the window edge and clean on the focal wall',
  }),
  cityScene({
    key: 'bal-office-garden',
    room: 'office',
    aesthetic: 'tropical',
    city: 'Bali',
    code: 'BAL',
    desc:
      'A Balinese garden studio: teak desk, rattan chair, monstera in a clay pot, limewashed walls, ' +
      'the edge of a bamboo blind in soft focus, terracotta floor.',
    materials: ['limewash', 'terracotta', 'teak', 'bamboo'],
    light: 'Green-tinted soft daylight from a garden opening',
  }),

  // Paris
  cityScene({
    key: 'par-living-haussmann',
    room: 'living-room',
    aesthetic: 'classic',
    city: 'Paris',
    code: 'PAR',
    desc:
      'A Parisian Haussmann salon: boucle sofa, brass floor lamp, small marble side table, ' +
      'light oak herringbone parquet, ivory painted paneling whose broad central panel is flat and bare, ' +
      'a hint of ceiling molding.',
    materials: ['ivory paneling', 'oak herringbone', 'marble', 'brass'],
    light: 'Gray-gold Parisian light through tall French windows',
  }),
  cityScene({
    key: 'par-dining-bistro',
    room: 'dining-room',
    aesthetic: 'classic',
    city: 'Paris',
    code: 'PAR',
    desc:
      'A Parisian dining corner: round marble bistro table, black bentwood chairs, ' +
      'a carafe and two glasses, herringbone oak floor, matte sage-gray painted wall.',
    materials: ['sage-gray paint', 'herringbone oak', 'marble', 'bentwood'],
    light: 'Late-morning window light',
  }),

  // Madrid
  cityScene({
    key: 'mad-dining-tertulia',
    room: 'dining-room',
    aesthetic: 'mediterranean',
    city: 'Madrid',
    code: 'MAD',
    desc:
      'A Madrid dining room: long walnut table, woven-leather chairs, ceramic pitcher, ' +
      'ochre plaster walls, terracotta tile floor.',
    materials: ['ochre plaster', 'terracotta tile', 'walnut', 'woven leather'],
    light: 'Strong golden Castilian late-afternoon light at a low angle',
  }),
  cityScene({
    key: 'mad-bedroom-classic',
    room: 'bedroom',
    aesthetic: 'warm',
    city: 'Madrid',
    code: 'MAD',
    desc:
      'A warm Madrid bedroom: upholstered headboard, warm-white linen, wooden shutters ajar ' +
      'at the window, oak floor, clay-white plaster walls.',
    materials: ['clay-white plaster', 'oak', 'linen', 'wooden shutters'],
    light: 'Warm dusk-toned side light',
  }),

  // Valencia
  cityScene({
    key: 'val-dining-tiled',
    room: 'dining-room',
    aesthetic: 'mediterranean',
    city: 'Valencia',
    code: 'VAL',
    desc:
      'A bright Valencian dining nook: pale wood table, cane-back chairs, a bowl of oranges, ' +
      'patterned hydraulic tile floor, matte white walls.',
    materials: ['hydraulic tiles', 'matte white plaster', 'pale wood', 'cane'],
    light: 'High bright Levante light, crisp',
  }),
  cityScene({
    key: 'val-hallway-entry',
    room: 'hallway',
    aesthetic: 'mediterranean',
    city: 'Valencia',
    code: 'VAL',
    desc:
      'A Valencian entry hall: slim console with a glazed ceramic lebrillo bowl, ' +
      'patterned hydraulic tile floor, white plaster walls.',
    materials: ['hydraulic tiles', 'white plaster', 'glazed ceramic'],
    light: 'Bright light reflected in from a courtyard',
  }),

  // Berlin
  cityScene({
    key: 'ber-office-altbau',
    room: 'office',
    aesthetic: 'minimal',
    city: 'Berlin',
    code: 'BER',
    desc:
      'A Berlin Altbau study with a high ceiling: plain birch desk, black task chair, slim floor lamp, ' +
      'a tall white double door in soft focus, white plaster walls, wide oak planks, a hint of stucco at the ceiling.',
    materials: ['white plaster', 'wide oak planks', 'birch', 'stucco trim'],
    light: 'Flat gray north light, calm',
  }),
  cityScene({
    key: 'ber-living-minimal',
    room: 'living-room',
    aesthetic: 'minimal',
    city: 'Berlin',
    code: 'BER',
    desc:
      'A minimal Berlin living room: gray modular sofa, concrete-top coffee table, one large plant, ' +
      'white walls, pale oak floor, the edge of a black steel shelf on a side wall.',
    materials: ['white plaster', 'pale oak', 'concrete', 'black steel'],
    light: 'Cool overcast daylight',
  }),

  // Stockholm
  cityScene({
    key: 'sto-living-funkis',
    room: 'living-room',
    aesthetic: 'scandinavian',
    city: 'Stockholm',
    code: 'STO',
    desc:
      'A Stockholm functionalist living room: pale gray sofa, ash armchair with a sheepskin, ' +
      'white walls, blond ash floor, flat-woven wool rug.',
    materials: ['white plaster', 'blond ash', 'wool', 'sheepskin'],
    light: 'Low golden Nordic sun, long soft shadows falling away from the focal wall',
  }),
  cityScene({
    key: 'sto-bedroom-birch',
    room: 'bedroom',
    aesthetic: 'scandinavian',
    city: 'Stockholm',
    code: 'STO',
    desc:
      'A Stockholm bedroom: birch bed with gray linen, small paper table lamp, ' +
      'pale birch floor, off-white walls.',
    materials: ['off-white plaster', 'birch', 'gray linen', 'paper'],
    light: 'Blue-hour softness, cool and quiet',
  }),

  // Los Angeles
  cityScene({
    key: 'la-living-canyon',
    room: 'living-room',
    aesthetic: 'mid-century',
    city: 'Los Angeles',
    code: 'LA',
    desc:
      'A Los Angeles canyon mid-century living room: tan leather sofa, walnut coffee table, ' +
      'large floor plant, smooth white plaster walls, warm wood floor, a clerestory window hint above.',
    materials: ['smooth white plaster', 'warm wood', 'tan leather', 'walnut'],
    light: 'Golden California light, a palm shadow only at the edge of frame',
  }),
  cityScene({
    key: 'la-office-studio',
    room: 'office',
    aesthetic: 'contemporary',
    city: 'Los Angeles',
    code: 'LA',
    desc:
      'A Los Angeles creative studio: white-oak desk, molded lounge-style chair, ' +
      'a few ceramic vessels, smooth white plaster walls, pale oak floor.',
    materials: ['smooth white plaster', 'pale oak', 'white oak', 'ceramic'],
    light: 'Bright even skylight glow',
  }),

  // Seattle
  cityScene({
    key: 'sea-office-cedar',
    room: 'office',
    aesthetic: 'warm',
    city: 'Seattle',
    code: 'SEA',
    desc:
      'A Seattle study: cedar desk, wool plaid throw over the chair, a fern on a low stool, ' +
      'cedar window trim, matte warm-white walls.',
    materials: ['cedar', 'matte warm-white plaster', 'wool plaid'],
    light: 'Soft rain-diffused gray light, moody but clean',
  }),
  cityScene({
    key: 'sea-hallway-craftsman',
    room: 'hallway',
    aesthetic: 'classic',
    city: 'Seattle',
    code: 'SEA',
    desc:
      'A Seattle craftsman entry: oak built-in bench, simple umbrella stand, ' +
      'stained fir trim, warm white walls, slate floor.',
    materials: ['stained fir', 'warm white plaster', 'oak', 'slate'],
    light: 'Gentle overcast light, a leaded window off-frame',
  }),

  // Rio de Janeiro
  cityScene({
    key: 'rio-living-modernist',
    room: 'living-room',
    aesthetic: 'mid-century',
    city: 'Rio de Janeiro',
    code: 'RIO',
    desc:
      'A Rio de Janeiro modernist living room: low wood-frame sofa with caramel leather cushions, ' +
      'sculptural lounge chair, monstera in a planter, polished concrete floor, warm white plaster walls.',
    materials: ['polished concrete', 'warm white plaster', 'caramel leather', 'dark tropical wood'],
    light: 'Bright tropical daylight with a sheer-curtain glow',
  }),
  cityScene({
    key: 'rio-bedroom-breeze',
    room: 'bedroom',
    aesthetic: 'tropical',
    city: 'Rio de Janeiro',
    code: 'RIO',
    desc:
      'A breezy Rio bedroom: bed in white cotton with a cane headboard, timber louvers in soft focus ' +
      'at the window, plaster walls, wood floor.',
    materials: ['plaster', 'wood floor', 'cane', 'timber louvers'],
    light: 'Warm airy morning light',
  }),

  // Tokyo
  cityScene({
    key: 'tok-bedroom-japandi',
    room: 'bedroom',
    aesthetic: 'japandi',
    city: 'Tokyo',
    code: 'TOK',
    desc:
      'A Tokyo japandi bedroom: low platform bed, the edge of a shoji screen in soft focus, ' +
      'a single ikebana branch in a dark vase, hinoki-toned wood floor, warm white plaster walls.',
    materials: ['warm white plaster', 'hinoki wood', 'shoji paper', 'dark ceramic'],
    light: 'Paper-diffused even light, serene',
  }),
  cityScene({
    key: 'tok-office-compact',
    room: 'office',
    aesthetic: 'japandi',
    city: 'Tokyo',
    code: 'TOK',
    desc:
      'A compact Tokyo study: narrow oak desk, small bonsai, a low shelf on a side wall, ' +
      'hinoki wood accents, matte plaster walls.',
    materials: ['matte plaster', 'hinoki', 'oak'],
    light: 'Soft window light through frosted glass',
  }),

  // Sydney
  cityScene({
    key: 'syd-living-coastal',
    room: 'living-room',
    aesthetic: 'coastal',
    city: 'Sydney',
    code: 'SYD',
    desc:
      'A Sydney coastal living room: white linen slipcover sofa, driftwood-toned coffee table, ' +
      'dried grasses in a tall vase, whitewashed timber floor, matte white walls.',
    materials: ['matte white plaster', 'whitewashed timber', 'white linen', 'driftwood tones'],
    light: 'Clear bright light, sea glare softened by sheer curtains',
  }),
  cityScene({
    key: 'syd-dining-harbour',
    room: 'dining-room',
    aesthetic: 'coastal',
    city: 'Sydney',
    code: 'SYD',
    desc:
      'A Sydney dining room: oak table, black-and-cane chairs, a water carafe, ' +
      'pale oak floor, white walls.',
    materials: ['white plaster', 'pale oak', 'cane', 'black steel'],
    light: 'Hard clean noon light, crisp shadows kept away from the focal wall',
  }),

  // Meribel
  cityScene({
    key: 'mer-bedroom-chalet',
    room: 'bedroom',
    aesthetic: 'alpine',
    city: 'Meribel',
    code: 'MER',
    desc:
      'An alpine chalet bedroom in Meribel: bed with a chunky wool blanket, sheepskin at its foot, ' +
      'lantern-style bedside lamp, aged spruce paneling on the side walls, a smooth lime-plaster focal wall, ' +
      'wide larch floorboards.',
    materials: ['lime plaster', 'aged spruce', 'larch', 'wool'],
    light: 'Bright snow-reflected light, cool white',
  }),
  cityScene({
    key: 'mer-living-fireside',
    room: 'living-room',
    aesthetic: 'alpine',
    city: 'Meribel',
    code: 'MER',
    desc:
      'A Meribel fireside living room: deep wool sofa, the edge of a rough stone fireplace in soft focus, ' +
      'stacked logs, larch wood accents, a smooth plaster focal wall.',
    materials: ['plaster', 'larch', 'rough stone', 'wool'],
    light: 'Crisp alpine daylight with warm interior tones',
  }),

  // Mallorca
  cityScene({
    key: 'mal-hallway-finca',
    room: 'hallway',
    aesthetic: 'mediterranean',
    city: 'Mallorca',
    code: 'MAL',
    desc:
      'A Mallorcan finca hallway: olive-wood bench, clay amphora, sand-toned lime plaster walls, ' +
      'an exposed stone edge at the doorway, terracotta floor.',
    materials: ['lime plaster', 'terracotta', 'olive wood', 'stone'],
    light: 'Hot bright light from a deep-set door, cool shadowed interior',
  }),
  cityScene({
    key: 'mal-dining-stone',
    room: 'dining-room',
    aesthetic: 'mediterranean',
    city: 'Mallorca',
    code: 'MAL',
    desc:
      'A Mallorcan finca dining room: long rustic table, rush-seat chairs, ceramic bowls, ' +
      'lime plaster walls, terracotta floor, a hint of a dark beam above.',
    materials: ['lime plaster', 'terracotta', 'rustic wood', 'rush'],
    light: 'Golden late light raking across the floor',
  }),

  // Venice
  cityScene({
    key: 'ven-bedroom-palazzo',
    room: 'bedroom',
    aesthetic: 'classic',
    city: 'Venice',
    code: 'VEN',
    desc:
      'A Venetian palazzo bedroom: bed with ivory linen, small antique chair, ' +
      'pale marmorino plaster walls, terrazzo floor.',
    materials: ['marmorino plaster', 'terrazzo', 'ivory linen', 'antique wood'],
    light: 'Lagoon-reflected shimmering soft light, slightly warm',
  }),
  cityScene({
    key: 'ven-hallway-portego',
    room: 'hallway',
    aesthetic: 'classic',
    city: 'Venice',
    code: 'VEN',
    desc:
      'A Venetian portego hall: slim console with a Murano glass vase, terrazzo floor, ' +
      'aged plaster walls.',
    materials: ['aged plaster', 'terrazzo', 'Murano glass'],
    light: 'Long window light, faint water reflections dancing on the ceiling only',
  }),

  // Vienna
  cityScene({
    key: 'vie-dining-jugendstil',
    room: 'dining-room',
    aesthetic: 'classic',
    city: 'Vienna',
    code: 'VIE',
    desc:
      'A Viennese dining room: round table with a coffee service, Thonet bentwood chairs, ' +
      'oak parquet, ivory walls with restrained molding kept off the flat focal panel.',
    materials: ['ivory plaster', 'oak parquet', 'bentwood', 'porcelain'],
    light: 'Refined soft daylight, classical',
  }),
  cityScene({
    key: 'vie-office-salon',
    room: 'office',
    aesthetic: 'classic',
    city: 'Vienna',
    code: 'VIE',
    desc:
      'A Viennese salon study: dark wood writing desk, green-shaded desk lamp, leather chair, ' +
      'oak parquet, muted gray-green walls.',
    materials: ['gray-green paint', 'oak parquet', 'dark wood', 'leather'],
    light: 'Quiet north light',
  }),

  // Zurich
  cityScene({
    key: 'zur-office-precise',
    room: 'office',
    aesthetic: 'minimal',
    city: 'Zurich',
    code: 'ZUR',
    desc:
      'A precise Zurich office: pale oak desk with a completely clean top, black chair, ' +
      'fine exposed concrete walls, oak floor.',
    materials: ['fine concrete', 'pale oak', 'black steel'],
    light: 'Clear alpine daylight, neutral white balance',
  }),
  cityScene({
    key: 'zur-dining-oak',
    room: 'dining-room',
    aesthetic: 'contemporary',
    city: 'Zurich',
    code: 'ZUR',
    desc:
      'A Zurich dining room: solid oak table, molded chairs, simple stoneware, ' +
      'white walls, concrete floor softened by a wool rug.',
    materials: ['white plaster', 'concrete', 'solid oak', 'stoneware'],
    light: 'Even, precise, cool-neutral light',
  }),

  // Munich
  cityScene({
    key: 'mun-dining-bavarian',
    room: 'dining-room',
    aesthetic: 'warm',
    city: 'Munich',
    code: 'MUN',
    desc:
      'A Bavarian-modern Munich dining room: oak table, upholstered bench along one side, ' +
      'ceramic jug, warm white plaster walls, wool textures.',
    materials: ['warm white plaster', 'oak', 'wool', 'ceramic'],
    light: 'Foehn-clear soft daylight, warm',
  }),
  cityScene({
    key: 'mun-hallway-altbau',
    room: 'hallway',
    aesthetic: 'classic',
    city: 'Munich',
    code: 'MUN',
    desc:
      'A Munich Altbau landing: simple bench, potted fig tree, a stucco edge at the ceiling, ' +
      'oak herringbone floor, matte white walls.',
    materials: ['matte white plaster', 'oak herringbone', 'stucco trim'],
    light: 'Stairwell skylight glow',
  }),

  // Lisbon
  cityScene({
    key: 'lis-hallway-pombaline',
    room: 'hallway',
    aesthetic: 'mediterranean',
    city: 'Lisbon',
    code: 'LIS',
    desc:
      'A Lisbon pombaline hallway: painted console, terracotta urn, pine plank floor, ' +
      'pastel rose plaster walls.',
    materials: ['pastel rose plaster', 'pine planks', 'terracotta', 'painted wood'],
    light: 'Atlantic-bright light with a soft haze',
  }),
  cityScene({
    key: 'lis-living-pastel',
    room: 'living-room',
    aesthetic: 'coastal',
    city: 'Lisbon',
    code: 'LIS',
    desc:
      'A Lisbon living room: caramel leather sofa, rattan chair, one azulejo-blue cushion as accent, ' +
      'pale pine floor, muted mint plaster walls.',
    materials: ['muted mint plaster', 'pale pine', 'caramel leather', 'rattan'],
    light: 'Silvery bright coastal light',
  }),

  // London
  cityScene({
    key: 'lon-office-study',
    room: 'office',
    aesthetic: 'classic',
    city: 'London',
    code: 'LON',
    desc:
      'A London terrace study: dark wood desk, brass lamp, stacked hardcovers, the edge of a wing chair, ' +
      'deep matte green walls, oak floor, white sash window trim in soft focus.',
    materials: ['deep green paint', 'oak', 'dark wood', 'brass'],
    light: 'Soft gray drizzle light, cozy',
  }),
  cityScene({
    key: 'lon-living-terrace',
    room: 'living-room',
    aesthetic: 'classic',
    city: 'London',
    code: 'LON',
    desc:
      'A Victorian terrace sitting room in London: navy sofa, the edge of a marble fireplace in soft focus, ' +
      'warm white walls with a hint of cornice, dark stained floorboards.',
    materials: ['warm white plaster', 'dark stained boards', 'marble', 'navy upholstery'],
    light: 'Muted north light through a bay window',
  }),

  // Oslo
  cityScene({
    key: 'osl-bedroom-dusk',
    room: 'bedroom',
    aesthetic: 'scandinavian',
    city: 'Oslo',
    code: 'OSL',
    desc:
      'An Oslo bedroom: pale bed with a chunky knit throw, unlit candle lantern on the nightstand, ' +
      'whitewashed pine floor, pale walls.',
    materials: ['pale plaster', 'whitewashed pine', 'chunky knit', 'linen'],
    light: 'Long low golden dusk light',
  }),
  cityScene({
    key: 'osl-hallway-entry',
    room: 'hallway',
    aesthetic: 'scandinavian',
    city: 'Oslo',
    code: 'OSL',
    desc:
      'An Oslo entry hall: birch bench, slim console, woven basket, pale pine floor, white walls.',
    materials: ['white plaster', 'pale pine', 'birch', 'woven fiber'],
    light: 'Cool bright snow light through the door glass',
  }),

  // Copenhagen
  cityScene({
    key: 'cop-dining-wishbone',
    room: 'dining-room',
    aesthetic: 'scandinavian',
    city: 'Copenhagen',
    code: 'COP',
    desc:
      'A Copenhagen dining room: round oak table with simple ceramics, wishbone chairs, ' +
      'a pendant lamp in soft focus above the table, white-oiled wide oak planks, white walls.',
    materials: ['white plaster', 'white-oiled oak', 'paper cord', 'ceramics'],
    light: 'Soft Danish daylight, warm and clean',
  }),
  cityScene({
    key: 'cop-living-hygge',
    room: 'living-room',
    aesthetic: 'scandinavian',
    city: 'Copenhagen',
    code: 'COP',
    desc:
      'A Copenhagen living room: greige wool sofa, paper pendant lamp, oak side table with unlit candles, ' +
      'white walls, oak floor.',
    materials: ['white plaster', 'oak', 'greige wool', 'paper'],
    light: 'Overcast soft glow',
  }),

  // Boston
  cityScene({
    key: 'bos-office-brownstone',
    room: 'office',
    aesthetic: 'classic',
    city: 'Boston',
    code: 'BOS',
    desc:
      'A Boston brownstone study: mahogany desk, brass lamp, leather chair, the edge of a fireplace, ' +
      'warm cream walls, dark walnut floor, painted shutters at the window edge.',
    materials: ['warm cream plaster', 'dark walnut', 'mahogany', 'leather'],
    light: 'Cool New England morning light',
  }),
  cityScene({
    key: 'bos-dining-federal',
    room: 'dining-room',
    aesthetic: 'classic',
    city: 'Boston',
    code: 'BOS',
    desc:
      'A Boston federal dining room: long dark table, spindle chairs, pewter candlesticks, ' +
      'greige painted wainscot below and flat plaster above, wide pine floorboards.',
    materials: ['greige wainscot', 'plaster', 'wide pine', 'pewter'],
    light: 'Crisp side light',
  }),

  // Miami
  cityScene({
    key: 'mia-living-deco',
    room: 'living-room',
    aesthetic: 'art-deco',
    city: 'Miami',
    code: 'MIA',
    desc:
      'A Miami deco living room: curved cream sofa, glass-and-chrome side table, palm in a planter, ' +
      'white terrazzo floor with pastel chips, smooth blush plaster walls.',
    materials: ['blush plaster', 'pastel terrazzo', 'chrome', 'palm green'],
    light: 'Intense subtropical light softened by sheers, bright and even',
  }),
  cityScene({
    key: 'mia-bedroom-pastel',
    room: 'bedroom',
    aesthetic: 'art-deco',
    city: 'Miami',
    code: 'MIA',
    desc:
      'A Miami bedroom: neutral upholstered bed, rattan bench at its foot, ' +
      'terrazzo floor, smooth pastel mint plaster walls.',
    materials: ['pastel mint plaster', 'terrazzo', 'rattan', 'neutral upholstery'],
    light: 'Bright morning glow',
  }),

  // Austin
  cityScene({
    key: 'aus-living-ranch',
    room: 'living-room',
    aesthetic: 'warm',
    city: 'Austin',
    code: 'AUS',
    desc:
      'An Austin ranch-modern living room: cognac leather sofa, live-edge coffee table, wool rug, ' +
      'a white limestone edge at the fireplace side, smooth white plaster focal wall, wide oak floor.',
    materials: ['white plaster', 'white limestone', 'wide oak', 'cognac leather'],
    light: 'Big warm Texas light, golden',
  }),
  cityScene({
    key: 'aus-office-barn',
    room: 'office',
    aesthetic: 'industrial',
    city: 'Austin',
    code: 'AUS',
    desc:
      'An Austin barn studio: reclaimed-wood desk, black steel chair, potted cactus, ' +
      'whitewashed shiplap on a side wall, smooth plaster focal wall, concrete floor.',
    materials: ['plaster', 'whitewashed shiplap', 'reclaimed wood', 'concrete'],
    light: 'Warm bright light from a steel-framed window',
  }),

  // Nice
  cityScene({
    key: 'nic-bedroom-riviera',
    room: 'bedroom',
    aesthetic: 'mediterranean',
    city: 'Nice',
    code: 'NIC',
    desc:
      'A Riviera bedroom in Nice: iron-frame bed with white linen, marble-top side table ' +
      'with an olive sprig in a glass, ivory ochre-washed plaster walls, patterned cement tile floor.',
    materials: ['ochre-washed plaster', 'cement tiles', 'wrought iron', 'marble'],
    light: 'Azure-bright Mediterranean light with a cool sky bounce',
  }),
  cityScene({
    key: 'nic-dining-morning',
    room: 'dining-room',
    aesthetic: 'mediterranean',
    city: 'Nice',
    code: 'NIC',
    desc:
      'A Nice dining corner: round table with an espresso set, rattan bistro chairs, ' +
      'ivory plaster walls, terracotta tile floor.',
    materials: ['ivory plaster', 'terracotta tiles', 'rattan'],
    light: 'Sparkling seaside morning light',
  }),

  // Dubai
  cityScene({
    key: 'dub-living-luxe',
    room: 'living-room',
    aesthetic: 'contemporary',
    city: 'Dubai',
    code: 'DUB',
    desc:
      'A contemporary luxe Dubai living room: low ivory sofa, bronze-edged coffee table, ' +
      'one sculptural vase, honed travertine floor, warm greige plaster walls.',
    materials: ['greige plaster', 'honed travertine', 'bronze', 'ivory boucle'],
    light: 'Desert light tamed by full-height sheers, golden-hour tone',
  }),
  cityScene({
    key: 'dub-dining-marble',
    room: 'dining-room',
    aesthetic: 'contemporary',
    city: 'Dubai',
    code: 'DUB',
    desc:
      'A Dubai dining room: marble-top table, sand-toned upholstered chairs, a single brass accent piece, ' +
      'travertine floor, greige plaster walls.',
    materials: ['greige plaster', 'travertine', 'marble', 'brass'],
    light: 'Soft diffused evenness with warm accents',
  }),
];

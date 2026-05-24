/**
 * Mockup-scene library — pre-generated empty-room photos used as
 * backgrounds for the in-room product photo (#6 in the per-artwork
 * mockup set).
 *
 * The catalog data lives in `mockup-scenes-catalog.mjs` so the one-time
 * generator script (`scripts/generate-mockup-scenes.mjs`) can read it
 * directly without parsing TypeScript. This file just re-exports it
 * with the strong TS type and adds helpers.
 */

import type { RoomType } from './gelato-templates';
import { MOCKUP_SCENES as CATALOG_SCENES } from './mockup-scenes-catalog.mjs';

export interface MockupScene {
  /** Stable storage key — also the Supabase Storage object name */
  key: string;
  /** Which room context this scene depicts */
  room: RoomType;
  /**
   * Optional aesthetic label for variant selection
   * (e.g. 'minimal', 'warm', 'mid-century'). Lets the operator (or
   * future agent) pick a scene whose mood matches the style pack.
   */
  aesthetic: 'minimal' | 'warm' | 'industrial' | 'mid-century' | 'scandinavian';
  /**
   * Generation prompt — used by the one-time scene generator.
   * Designed to produce a photo with:
   *   - A clean wall section sized to host portrait poster art
   *   - Believable ambient light (no direct sun glare on the wall)
   *   - Visual scale anchors (furniture, fixtures) so AI compositing
   *     can size the inset correctly
   *   - No existing wall art (so the composite doesn't fight a frame
   *     already in the scene)
   */
  prompt: string;
  /** Aspect ratio for generation — landscape rooms read wider */
  aspectRatio: '16:9' | '4:3' | '3:2';
  /**
   * Approximate location of the wall area where the art should sit,
   * expressed as fractional bounding box (x, y, w, h) in [0, 1].
   * Used when we move from "Gemini, please place the art" to a more
   * deterministic compositor later.
   */
  wallTarget: { x: number; y: number; w: number; h: number };
}

export const MOCKUP_SCENES: MockupScene[] = CATALOG_SCENES as MockupScene[];

export type MockupSceneKey = (typeof MOCKUP_SCENES)[number]['key'];

export function getScene(key: string): MockupScene | undefined {
  return MOCKUP_SCENES.find((s) => s.key === key);
}

/**
 * Pick a scene for a given room. If `aestheticHint` is provided (e.g.
 * derived from the artwork's style pack), prefer that aesthetic;
 * otherwise return any scene for the room. Cycles through scenes by
 * artwork id so two pieces in a row don't reuse the same backdrop.
 */
export function pickSceneForRoom(
  room: RoomType,
  artworkId: string,
  aestheticHint?: MockupScene['aesthetic']
): MockupScene {
  const candidates = MOCKUP_SCENES.filter((s) => s.room === room);
  if (candidates.length === 0) {
    return MOCKUP_SCENES[0];
  }

  const filtered = aestheticHint
    ? candidates.filter((s) => s.aesthetic === aestheticHint)
    : candidates;
  const pool = filtered.length > 0 ? filtered : candidates;

  // Deterministic-but-spreading selection by hashing the artwork id
  let hash = 0;
  for (let i = 0; i < artworkId.length; i++) {
    hash = (hash * 31 + artworkId.charCodeAt(i)) | 0;
  }
  return pool[Math.abs(hash) % pool.length];
}

/**
 * Storage path for a generated scene image. Used by the scene
 * generator and by the per-artwork composer.
 */
export const MOCKUP_SCENES_BUCKET = 'ai-generated';
export function sceneStoragePath(key: string): string {
  return `mockup-scenes/${key}.png`;
}

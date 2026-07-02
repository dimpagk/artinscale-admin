import type { StylePack } from './types';

import bauhausPrime from './bauhaus-prime.json';
import linework from './linework-meridian.json';
import risograph from './risograph-pulse.json';
import olympiaWash from './olympia-wash.json';
import athensInk from './athens-ink.json';
import corfuGouache from './corfu-gouache.json';
import amsterdamNocturne from './amsterdam-nocturne.json';
import newyorkOil from './newyork-oil.json';
import nordicDusk from './nordic-dusk.json';

export type { StylePack } from './types';

/**
 * JSON-backed registry — bundled at build time, available synchronously
 * to client components.
 *
 * IMPORTANT: this module deliberately does NOT import from `./db` or
 * `./server`. Those touch `supabaseAdmin` (service-role) and would be
 * server-only. Importing them here causes the client bundle to crash
 * with "supabaseKey is required" when prompt-builder (a 'use client'
 * file) imports `listLaunchStylePacks`. For DB-aware lookups use
 * `@/lib/style-packs/server` from server code only.
 */
export const STYLE_PACKS: Record<string, StylePack> = {
  [risograph.id]: risograph as StylePack,
  [linework.id]: linework as StylePack,
  [bauhausPrime.id]: bauhausPrime as StylePack,
  [olympiaWash.id]: olympiaWash as StylePack,
  [athensInk.id]: athensInk as StylePack,
  [corfuGouache.id]: corfuGouache as StylePack,
  [amsterdamNocturne.id]: amsterdamNocturne as StylePack,
  [newyorkOil.id]: newyorkOil as StylePack,
  [nordicDusk.id]: nordicDusk as StylePack,
};

/** Synchronous lookup — JSON only. Use in client components. */
export function getStylePack(id: string): StylePack | null {
  return STYLE_PACKS[id] ?? null;
}

/** Synchronous list — JSON only. Use in client components. */
export function listStylePacks(): StylePack[] {
  return Object.values(STYLE_PACKS);
}

/** Synchronous list of launch packs — JSON only. */
export function listLaunchStylePacks(): StylePack[] {
  return listStylePacks().filter((pack) => pack.enabledForLaunch);
}

/**
 * Find the style pack owned by a given artist (synchronous, JSON-only).
 *
 * Source of truth: `pack.persona.userId`. Replaces the hardcoded
 * `{a01: 'risograph-pulse', a02: 'linework-meridian', ...}` maps that
 * used to live in 4+ places — agents, the AI Art Generator client,
 * etc.
 *
 * For server-side / DB-aware lookups (which honor operator edits in
 * the `style_packs` table) use `getStylePackForArtistAsync` from
 * `@/lib/style-packs/server`.
 */
export function getStylePackForArtist(artistId: string | null | undefined): StylePack | null {
  if (!artistId) return null;
  return listStylePacks().find((p) => p.persona.userId === artistId) ?? null;
}

/**
 * Reverse lookup: which artist owns this style pack?
 * Returns the persona's userId, or null if the pack id is unknown.
 */
export function getArtistIdForStylePack(stylePackId: string | null | undefined): string | null {
  if (!stylePackId) return null;
  return getStylePack(stylePackId)?.persona.userId ?? null;
}

/**
 * Build the final Gemini prompt by combining a style pack's master prompt
 * with subject + optional contribution context. Keeps the style pack as
 * the single source of truth for "what makes this artist's voice".
 *
 * Accepts a pre-resolved `pack` arg for callers that have already fetched
 * the DB-backed version; otherwise falls back to the JSON registry.
 */
export function buildStyledPrompt(args: {
  stylePackId: string;
  subject: string;
  contributionContext?: string;
  pack?: StylePack;
}): string {
  const pack = args.pack ?? getStylePack(args.stylePackId);
  if (!pack) {
    throw new Error(
      `Unknown style pack "${args.stylePackId}". ` +
        `Known packs: ${Object.keys(STYLE_PACKS).join(', ')}`
    );
  }

  const sections: string[] = [];

  sections.push(`Style: ${pack.prompt.master}`);

  sections.push(
    `Palette: strict adherence to these hex colors only — ${pack.palette.colors.join(', ')}. ${pack.palette.description}`
  );

  sections.push(
    `Composition: ${pack.composition.subjectPlacement}, ` +
      `at most ${pack.composition.maxSubjects} primary subject(s). ` +
      `${pack.composition.notes}`
  );

  sections.push(`Subject: ${args.subject}`);

  if (args.contributionContext) {
    sections.push(
      `Community context (use as inspiration, do not depict literally): ${args.contributionContext}`
    );
  }

  sections.push(`Avoid: ${pack.prompt.negative}`);

  return sections.join('\n\n');
}

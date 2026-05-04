/**
 * Style packs encapsulate everything needed to generate a coherent
 * "AI artist" voice: prompt template, palette, composition rules, and
 * the persona shown to customers.
 *
 * Stored as JSON in this folder rather than a DB table at launch — keeps
 * iteration fast and version-controlled. A `styles` table can come later
 * once the values stabilize.
 */

export interface StylePackPersona {
  /** Public-facing display name */
  name: string;
  /** Short hook shown alongside the name */
  tagline: string;
  /** Customer-facing bio (1–2 paragraphs) */
  bioMd: string;
  /** Description of the artist's "process" — used in social copy */
  processMd: string;
  /** Email used to seed the user record in Supabase */
  email: string;
  /**
   * Stable UUID — must match the seed migration so the artist row can
   * be referenced as `artworks.artist_id` reliably across deploys.
   */
  userId: string;
}

export interface StylePackPrompt {
  /** Master prompt fragment injected into every generation for this style */
  master: string;
  /** Negative prompt / exclusions */
  negative: string;
}

export interface StylePackPalette {
  /** Hex color codes locked for this style (4–6 entries) */
  colors: string[];
  /** Human-readable description of how the palette is used */
  description: string;
}

export interface StylePackComposition {
  /** Aspect ratios this style supports (e.g. "1:1", "4:5", "2:3") */
  aspectRatios: string[];
  /** Where the subject sits ("center-weighted", "rule-of-thirds", etc.) */
  subjectPlacement: string;
  /** Soft maximum number of distinct subjects per piece */
  maxSubjects: number;
  /** Free-form notes about layering, foreground/background discipline */
  notes: string;
}

export interface StylePack {
  /** Stable id (kebab-case). Must match the JSON filename without `.json` */
  id: string;
  /** Whether this style ships in the launch collection */
  enabledForLaunch: boolean;
  persona: StylePackPersona;
  prompt: StylePackPrompt;
  palette: StylePackPalette;
  composition: StylePackComposition;
  /**
   * Whether this style is expected to vectorize cleanly in a future v2
   * vector pipeline. Phase 1 launch styles should all be true.
   */
  vectorizesWell: boolean;
  /**
   * Optional moodboard/reference asset paths under `public/style-refs/`.
   * Used as visual aids for the human curator — NOT fed to the model
   * unless image-conditioning is wired into the generator later.
   */
  referenceAssetPaths?: string[];
  /**
   * Whether this pack is the artist's *primary* (default) voice.
   * Each artist can own multiple packs (e.g. seasonal variants, A/B tests),
   * but exactly one is marked primary at any given time. Downstream agents
   * (drop campaigns, comment replies, email drops) use the primary pack
   * unless the artwork explicitly points at a different one.
   *
   * Defaults to true for JSON-shipped packs and for the first pack an
   * artist owns. Migration 014 enforces uniqueness with a partial index.
   */
  isPrimary?: boolean;
}

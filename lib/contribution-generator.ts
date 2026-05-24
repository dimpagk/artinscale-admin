import { callClaude, extractJson } from './agents/base';
import { generatePhotoForCaption } from './agents/image-generator';
import { supabaseAdmin } from './supabase/admin';
import type { TopicRow, ContributionType } from './types';

interface GeneratedContribution {
  type: ContributionType;
  contributor_name: string;
  contributor_email: string;
  contributor_location: string;
  content: string;
  caption: string | null;
  // Photo-only, transient: a literal physical description used as the
  // nano-banana prompt. Never persisted — caption is what users see.
  image_brief?: string;
}

const VALID_TYPES: readonly ContributionType[] = ['story', 'photo', 'sound', 'link'];

function normalizeType(raw: unknown): ContributionType | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if ((VALID_TYPES as readonly string[]).includes(t)) return t as ContributionType;
  if (t === 'stories') return 'story';
  if (t === 'photos' || t === 'image' || t === 'images') return 'photo';
  if (t === 'sounds' || t === 'audio' || t === 'music') return 'sound';
  if (t === 'links' || t === 'url' || t === 'article') return 'link';
  return null;
}

function spreadDates(count: number, topicCreatedAt: string, deadline: string | null): Date[] {
  const start = new Date(topicCreatedAt);
  const end = deadline ? new Date(deadline) : new Date();
  if (end <= start) {
    const fallback = new Date(start);
    fallback.setDate(fallback.getDate() + 30);
    return spreadDates(count, topicCreatedAt, fallback.toISOString());
  }

  const range = end.getTime() - start.getTime();
  const dates: Date[] = [];

  for (let i = 0; i < count; i++) {
    const base = start.getTime() + Math.random() * range;
    const jitterHours = (Math.random() - 0.5) * 8;
    const ts = new Date(base + jitterHours * 3600_000);
    if (ts < start) ts.setTime(start.getTime() + Math.random() * 3600_000 * 2);
    if (ts > end) ts.setTime(end.getTime() - Math.random() * 3600_000 * 2);
    dates.push(ts);
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
}

function buildPrompt(topic: TopicRow, count: number, instructions?: string): { system: string; user: string } {
  const typeDescriptions = (topic.contribution_types || [])
    .map((ct) => `- ${ct.type}: ${ct.title} — ${ct.description}`)
    .join('\n');

  const availableTypes = (topic.contribution_types || []).map((ct) => ct.type);
  const validTypes = availableTypes.length > 0
    ? availableTypes.filter((t): t is ContributionType => ['story', 'photo', 'sound', 'link'].includes(t))
    : ['story', 'photo', 'link'] as ContributionType[];

  const promptExamples = (topic.prompts || []).join('\n- ');

  const system = `You generate realistic community contributions for a collaborative art project called ArtInScale.
These contributions look like they come from real people responding to an art topic prompt.

Voice rules (apply to every story and caption):
- Write like a normal person, not a poet. Plain, direct prose; short sentences are fine.
- NEVER use em-dashes (—) or en-dashes (–). Use commas, periods, or parentheses.
- Avoid contemplative-app clichés: "Just breathe", "Just sitting", "Just being present", "the present moment", "letting go", "feels like home", "find your center". Real people don't talk like meditation app copy.
- Be concrete. Mention specific places, times, small physical details. Avoid grand statements.
- About 25% of contributions should contain natural imperfections — vary the kinds: lowercase "i", missing apostrophes ("dont", "its"), occasional run-on sentences, mixed tense, dropped articles ("went to store"), or non-native English syntax. Many community members are not native English speakers; let that show in word choice and sentence shape.
- Use diverse contributor names (international, varied ethnicities and genders) and real-sounding cities worldwide.
- Generate plausible email addresses (firstname.lastname@gmail.com, short nicknames@yahoo.com, etc).

Content per type:
- "story": 60-150 words, target ~90. Personal, specific, concrete. No grand summing-up at the end.
- "photo": produce TWO separate fields with very different jobs.
  - "image_brief": a 1-2 sentence physical description of what's in the photo (subject, setting, lighting, what's visible) PLUS an explicit photographic style. This is the FULL prompt sent to image generation — never shown to users. Vary the style per contribution; do NOT default everything to clean modern smartphone:
    • ~45% "casual modern smartphone snapshot" — everyday phone shot, natural lighting, slightly imperfect framing
    • ~25% "older Android/iPhone, ~5-7 years old" — slightly grainy, soft focus, low-light noise, slightly washed colors, looks dated
    • ~15% "documentary candid" — in-the-moment, real-life setting, sometimes slight motion blur or off-center subject
    • ~10% "selfie or hand-held close-up" — close framing, natural light, sometimes off-center
    • ~5% "professional event or portrait photography" — use sparingly, only when the caption clearly implies something polished (a stage moment, a published author, a studio session). Sharp focus, intentional composition.
    • Avoid stock-photo aesthetic and AI-glossy renders. Vary subject framing and angle so successive photos don't look the same.
  - "caption": 1-2 short sentences in the contributor's own voice. What a real person would actually write under their own photo: personal, contextual, evocative. NOT a description of what's in the image.
    - BAD (looks AI): "A woman in a bright orange wrap sitting on a plastic chair outside a yellow building."
    - GOOD: "Auntie's chair on the porch. I come here when the house gets too loud."
    - Apply the voice rules above (no clichés, plain prose, possible imperfection).
  - Set "content" to "pending" — we replace it with the generated image URL.
- "sound": use the web_search tool to find an ACTUAL working URL on SoundCloud, Bandcamp, YouTube, or Spotify that matches what a community member might share for this topic. Do NOT invent URLs — invented URLs are 404s and ship as broken links. Caption is in the contributor's voice (a sentence about why they're sharing it), not a literal audio description.
- "link": use the web_search tool to find an ACTUAL working URL of an article, blog post, video, or resource that matches what a community member would share for this topic. Do NOT invent URLs — they hallucinate. Prefer canonical sources (YouTube, Wikipedia, NYT/BBC/Guardian, Aeon, the speaker's own site, peer-reviewed journals). Caption explains in the contributor's voice why they're sharing it.

Type mix: stories most common (~40-50%), photos (~25-30%), then links and sounds. Don't force equal distribution.

The "type" field MUST be exactly one of these singular strings (no plurals, no synonyms): ${JSON.stringify(validTypes)}
${instructions?.trim() ? `\nADDITIONAL OPERATOR INSTRUCTIONS (apply strictly to all output):\n${instructions.trim()}` : ''}

Return a JSON array of objects with these exact fields:
{ type, contributor_name, contributor_email, contributor_location, content, caption, image_brief? }

caption is null for story type and a string for photo/sound/link types.
image_brief is required for photo type only; omit it for other types.`;

  const user = `Generate exactly ${count} contributions for this topic:

Topic: "${topic.title}"
Description: ${topic.description}
${topic.long_description ? `Details: ${topic.long_description}` : ''}

Contribution types accepted:
${typeDescriptions || 'Stories, photos, sounds, links'}

${promptExamples ? `Suggested prompts for contributors:\n- ${promptExamples}` : ''}

Return ONLY the JSON array, no other text.`;

  return { system, user };
}

type RefinedContribution = {
  id: string;
  content: string;
  caption: string | null;
  // Optional, photo-only: a literal physical description that drives a
  // nano-banana regen. Transient — never persisted to the DB.
  image_brief?: string;
};

/**
 * Update `agent_tasks.output` mid-flight so the UI can show progress
 * (e.g. "12/32 refined"). Best-effort: failures are logged and ignored
 * so progress writes never block the actual work.
 */
async function reportProgress(
  taskId: string | undefined,
  output: Record<string, unknown>
): Promise<void> {
  if (!taskId) return;
  const { error } = await supabaseAdmin
    .from('agent_tasks')
    .update({ output })
    .eq('id', taskId);
  if (error) console.error('reportProgress failed (non-fatal):', error.message);
}

async function checkUrlAlive(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    } catch {
      // Some hosts reject HEAD — fall back to a GET with a small range
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Range: 'bytes=0-1023' },
      });
    } finally {
      clearTimeout(timeout);
    }
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

async function retryBrokenUrls(
  topic: TopicRow,
  feedback: string,
  broken: RefinedContribution[],
  originalsById: Map<string, { id: string; type: string; content: string; caption: string | null }>
): Promise<RefinedContribution[]> {
  const retrySystem = `You replace broken URLs in community-art contributions. Each input has an id, type, current_caption, and a previously_suggested_url that was confirmed dead via HTTP request.

Use the web_search tool to find a DIFFERENT working URL for each item. Strict rules:
- Do NOT return any of the previously_suggested_url values, no exceptions.
- Avoid URL patterns that match a known-broken domain pattern. If the broken URL is on ted.com, return a DIFFERENT platform: YouTube, the speaker's official site, Wikipedia, or a major news outlet.
- Pick URLs that appear DIRECTLY in search results with the matching subject — not URLs reconstructed from patterns.
- For TEDx talks specifically, prefer YouTube (youtube.com/watch?v=…). Many TEDx talks are not on ted.com at all.
- Set "content" to the new URL. Keep caption intact unless small adjustments are needed.

Return a JSON array: [{ id, content, caption }].`;

  const items = broken.map((r) => {
    const orig = originalsById.get(r.id);
    return {
      id: r.id,
      type: orig?.type,
      previously_suggested_url: r.content,
      current_caption: r.caption ?? orig?.caption ?? '',
      original_broken_url: orig?.content,
    };
  });

  const retryUser = `Topic: "${topic.title}"

Operator feedback context: ${feedback}

These URLs were confirmed broken (HTTP 4xx/5xx). Find different working URLs:
${JSON.stringify(items, null, 2)}

Return only the JSON array.`;

  try {
    const raw = await callClaude({
      system: retrySystem,
      user: retryUser,
      maxTokens: 2048,
      tools: { webSearch: true, webSearchMaxUses: 4 },
    });
    const parsed = extractJson<unknown>(raw);
    if (!Array.isArray(parsed)) {
      console.error('retryBrokenUrls got non-array:', raw.slice(0, 200));
      return broken;
    }
    return parsed as RefinedContribution[];
  } catch (err) {
    console.error('retryBrokenUrls failed:', err);
    return broken; // give up gracefully — keep original Claude output
  }
}

export async function refinePendingSeedContributions(
  topic: TopicRow,
  instructions: string,
  ids?: string[],
  taskId?: string
): Promise<{ updated: number; error?: string }> {
  const trimmed = instructions.trim();
  if (!trimmed) return { updated: 0, error: 'Instructions are required' };

  let query = supabaseAdmin
    .from('topic_contributions')
    .select('id, type, content, caption, previous_versions')
    .eq('topic_id', topic.id)
    .eq('status', 'pending')
    .eq('source', 'studio_seed');

  if (ids && ids.length > 0) {
    query = query.in('id', ids);
  }

  const { data: pending, error: fetchError } = await query;

  if (fetchError) {
    return { updated: 0, error: `Fetch failed: ${fetchError.message}` };
  }
  if (!pending || pending.length === 0) {
    return { updated: 0, error: 'No pending seed contributions to refine' };
  }

  await reportProgress(taskId, {
    phase: 'refining',
    target: pending.length,
    progress: 0,
  });

  const buildRefineSystem = (canUseWebSearch: boolean) => `You rewrite community-art contribution content based on operator feedback.
Preserve the original meaning and structure but apply the feedback exactly.
Return a JSON array with the same length and order as the input.

Each output object: { id, content, caption, image_brief? }
- For "story" type: rewrite "content" with the feedback applied. Set "caption" to null. Omit "image_brief".
- For "photo" type: "content" is a URL — keep it unchanged unless an image regen is requested.
  - "caption" is the contributor-voice text shown under the photo. Keep it personal and contextual (what a real person would write under their own photo) — NOT a literal description of what's in the image. Example: "Auntie's chair on the porch. I come here when the house gets too loud" — NOT "A woman sitting on a chair outside a yellow building."
  - If the operator's feedback indicates the IMAGE itself is wrong (image doesn't match, photo is irrelevant, regenerate, different image, "less professional", "more amateur", "older phone", etc.), ALSO produce an "image_brief" field — a 1-2 sentence literal physical description of the new image PLUS a photographic style. This is the full prompt sent to image generation; never shown to users. Pick the style that fits the operator's feedback and the caption's context:
    • "casual modern smartphone snapshot" — everyday phone shot, natural lighting, slightly imperfect framing (default for personal moments)
    • "older Android/iPhone, ~5-7 years old, slightly grainy and washed" — when feedback says "less professional", "amateur", "older phone", "less AI", or the caption suggests something everyday and unpolished
    • "documentary candid, slight motion blur" — in-the-moment slice-of-life
    • "selfie or hand-held close-up, natural light" — for self-portraits
    • "professional event/portrait photography, sharp focus, intentional composition" — only when the caption clearly implies something polished (stage, published, studio)
    • Avoid stock-photo aesthetic and AI-glossy renders unless the caption clearly demands it.
  - Omit "image_brief" if the operator's feedback is only about the caption.
- For "sound"/"link" types: "content" is a URL. By default keep it unchanged and rewrite "caption" in the contributor's voice. Omit "image_brief".${canUseWebSearch ? `
- For sound/link, if the operator's feedback hints in any way that the URL is wrong (broken, dead, missing, 404, "page not found", "doesn't load", "are you sure", "find a real one", "replace", etc.): use the web_search tool to find an actual working URL that matches the subject. Do NOT guess URLs from memory — they hallucinate.
  • Search for the subject (e.g. "Sara Lazar TED talk meditation YouTube") and choose a URL from results that points DIRECTLY to the canonical source — not a blog post that references it.
  • IMPORTANT: if the broken URL was on ted.com, do NOT replace with another ted.com URL of the same shape. Prefer YouTube (youtube.com/watch?v=…), the speaker's own site, or a major news outlet. Many "TEDx" talks are only on YouTube, not ted.com.
  • Prefer URLs that appear as direct results in the search, not URLs reconstructed from patterns.
  • Valid sources for "link": YouTube, Spotify, speaker's own site, Wikipedia, NYT/BBC/Guardian, Aeon. For "sound": SoundCloud/Bandcamp/YouTube.
  • If web search returns nothing usable, write a short caption reflecting on the topic (no link reference) and pick a clean Wikipedia URL on the broader subject as a safe fallback.` : ''}
- Never write meta-commentary inside content/caption ("this link no longer works", "⚠ unavailable"). If a URL is bad, replace it (via web_search) instead of describing the problem.
- NEVER emit XML tool-call syntax like <function_calls> or <invoke> in your text output. Tools are invoked through the structured tool API, not by writing tags.

Do not change types or ids. After any tool use, output ONLY the final JSON array as your last text — no prose, no markdown fences except the array itself.`;

  const BATCH_SIZE = 6;
  const batches: typeof pending[] = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    batches.push(pending.slice(i, i + BATCH_SIZE));
  }

  const refinedAll: RefinedContribution[] = [];
  let firstBatchError: unknown = null;
  let firstBatchEmptyResponse: string | null = null;
  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      // Always enable web_search if the batch has link/sound rows; the
      // tool only costs when actually called, and the operator's intent
      // (broken URL? simpler caption?) is hard to detect by regex.
      const enableSearch = batch.some(
        (b) => b.type === 'link' || b.type === 'sound'
      );
      const system = buildRefineSystem(enableSearch);

      const user = `Topic: "${topic.title}"
Description: ${topic.description}

Operator feedback to apply:
${trimmed}

Contributions to refine (${batch.length} in this batch):
${JSON.stringify(batch, null, 2)}

Return only the JSON array, no other text.`;
      try {
        const raw = await callClaude({
          system,
          user,
          maxTokens: 4096,
          tools: enableSearch ? { webSearch: true, webSearchMaxUses: 6 } : undefined,
        });
        const parsed = extractJson<unknown>(raw);
        if (!Array.isArray(parsed)) {
          const shape =
            parsed && typeof parsed === 'object'
              ? `object with keys [${Object.keys(parsed).join(', ')}]`
              : typeof parsed;
          throw new Error(
            `Claude returned non-array (${shape}). Response head: ${raw.slice(0, 200)}`
          );
        }
        if (parsed.length === 0 && batch.length > 0 && !firstBatchEmptyResponse) {
          firstBatchEmptyResponse = raw.slice(0, 300);
        }
        return parsed as RefinedContribution[];
      } catch (err) {
        console.error('refine batch failed:', err);
        if (!firstBatchError) firstBatchError = err;
        return [] as RefinedContribution[];
      }
    })
  );
  for (const r of batchResults) refinedAll.push(...r);

  const byId = new Map(pending.map((p) => [p.id, p]));

  // Image regen path: when feedback suggests the image is the problem,
  // regenerate via nano-banana for every pending photo — independent of
  // what Claude returned. Claude usually returns nothing useful for
  // "image doesn't match" because it can't see the image; we still want
  // to fix the row.
  const feedbackSuggestsImageRegen =
    /\b(image|photo|picture|mismatch|doesn'?t match|wrong photo|wrong image|new photo|new image|regenerate|different photo|different image)\b/i.test(
      trimmed
    );
  if (feedbackSuggestsImageRegen) {
    const refinedById = new Map(refinedAll.map((r) => [r.id, r]));
    const photoEntries = pending.filter((p) => p.type === 'photo');
    await Promise.all(
      photoEntries.map(async (orig) => {
        const refined = refinedById.get(orig.id);
        const refinedCaption =
          refined && typeof refined.caption === 'string'
            ? refined.caption
            : orig.caption;
        // Prefer Claude's image_brief (literal description); fall back to
        // the caption only if missing — captions are now contributor
        // voice and make poor gen prompts.
        const briefFromClaude =
          refined && typeof refined.image_brief === 'string'
            ? refined.image_brief.trim()
            : '';
        const promptForGen =
          briefFromClaude || (refinedCaption ?? '').toString().trim();
        if (!promptForGen) return;
        const result = await generatePhotoForCaption({
          caption: promptForGen,
          topicTitle: topic.title,
          topicDescription: topic.description,
        });
        if ('url' in result) {
          const merged: RefinedContribution = {
            id: orig.id,
            content: result.url,
            caption: refinedCaption,
          };
          const idx = refinedAll.findIndex((r) => r.id === orig.id);
          if (idx >= 0) refinedAll[idx] = merged;
          else refinedAll.push(merged);
        } else {
          console.error('refine image regen failed:', orig.id, result.error);
          if (!firstBatchError) firstBatchError = new Error(result.error);
        }
      })
    );
  }

  if (refinedAll.length === 0) {
    const detail =
      firstBatchError instanceof Error
        ? firstBatchError.message
        : firstBatchError
        ? String(firstBatchError)
        : firstBatchEmptyResponse
        ? `Claude returned an empty array. Response head: ${firstBatchEmptyResponse}`
        : '';
    return {
      updated: 0,
      error: detail
        ? `AI refinement failed: ${detail}`
        : 'AI refinement failed for all batches',
    };
  }

  await reportProgress(taskId, {
    phase: 'validating',
    target: pending.length,
    progress: refinedAll.length,
  });

  // For non-story types, HEAD-check the URL Claude returned. If the
  // operator's feedback flagged URLs as broken we always validate (even
  // if Claude kept the same URL — that's the failure mode); otherwise
  // we only check when the URL changed.
  const feedbackMentionsBrokenUrl = /\b(broken|dead|missing|wrong|404|real|swap|replace|find|url|link)\b/i.test(trimmed);
  const needsRevalidation: RefinedContribution[] = [];
  for (const r of refinedAll) {
    const original = byId.get(r.id);
    if (!original) continue;
    if (original.type === 'story') continue;
    const newUrl = typeof r.content === 'string' ? r.content : '';
    const oldUrl = typeof original.content === 'string' ? original.content : '';
    if (!newUrl || !newUrl.startsWith('http')) continue;
    const shouldValidate = feedbackMentionsBrokenUrl || newUrl !== oldUrl;
    if (!shouldValidate) continue;
    const ok = await checkUrlAlive(newUrl);
    if (!ok) needsRevalidation.push(r);
  }

  if (needsRevalidation.length > 0) {
    const retried = await retryBrokenUrls(topic, trimmed, needsRevalidation, byId);
    // Replace entries in refinedAll with retried versions
    const retriedById = new Map(retried.map((r) => [r.id, r]));
    for (let i = 0; i < refinedAll.length; i++) {
      const replacement = retriedById.get(refinedAll[i].id);
      if (replacement) refinedAll[i] = replacement;
    }
  }

  let updated = 0;

  await Promise.all(
    refinedAll.map(async (r) => {
      const original = byId.get(r.id);
      if (!original) return;
      if (typeof r.content !== 'string') return;

      const isStory = original.type === 'story';
      // Stories: rewritten body in content. Media types: trust Claude's
      // returned URL (the prompt allows replacement when the operator
      // flags it as broken; otherwise Claude was told to keep it as-is).
      const newContent = typeof r.content === 'string' ? r.content : original.content;
      const newCaption = isStory ? null : (typeof r.caption === 'string' ? r.caption : original.caption);

      // Skip if nothing actually changed — don't pollute version history
      if (newContent === original.content && newCaption === original.caption) {
        return;
      }

      // Capture current state into previous_versions before overwriting.
      // Cap at 5 entries to keep the column small.
      const versionEntry = {
        at: new Date().toISOString(),
        content: original.content,
        caption: original.caption ?? null,
        refine_task_id: taskId ?? null,
        instructions: trimmed,
      };
      const existing = Array.isArray(original.previous_versions) ? original.previous_versions : [];
      const nextVersions = [versionEntry, ...existing].slice(0, 5);

      const { error: updateError } = await supabaseAdmin
        .from('topic_contributions')
        .update({
          content: newContent,
          caption: newCaption,
          previous_versions: nextVersions,
        })
        .eq('id', r.id);

      if (!updateError) updated++;
    })
  );

  return { updated };
}

export async function generateContributions(
  topic: TopicRow,
  count: number,
  instructions?: string,
  taskId?: string
): Promise<{ created: number; error?: string; imageFailures?: string[] }> {
  if (count < 1 || count > 50) {
    return { created: 0, error: 'Count must be between 1 and 50' };
  }

  await reportProgress(taskId, {
    phase: 'generating',
    target: count,
    progress: 0,
  });

  const { system, user } = buildPrompt(topic, count, instructions);

  // Enable Anthropic's hosted web_search when the topic accepts links
  // or sounds — without it Claude invents plausible-looking URLs that
  // 404. Photos go through nano-banana so they don't need search.
  const allowedTypes = (topic.contribution_types ?? []).map((ct) => ct.type);
  const mayNeedWebSearch =
    allowedTypes.length === 0 ||
    allowedTypes.includes('link') ||
    allowedTypes.includes('sound');

  let contributions: GeneratedContribution[];
  try {
    const raw = await callClaude({
      system,
      user,
      maxTokens: 8192,
      tools: mayNeedWebSearch
        ? { webSearch: true, webSearchMaxUses: 12 }
        : undefined,
    });
    contributions = extractJson<GeneratedContribution[]>(raw);
  } catch (err) {
    return { created: 0, error: `AI generation failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!Array.isArray(contributions) || contributions.length === 0) {
    return { created: 0, error: 'AI returned no contributions' };
  }

  const valid = contributions
    .map((c) => ({ ...c, type: normalizeType(c.type) }))
    .filter((c): c is GeneratedContribution => c.type !== null);

  if (valid.length === 0) {
    return { created: 0, error: 'AI returned no contributions with valid types' };
  }

  // Replace Claude-invented photo URLs with real nano-banana generated
  // images that actually depict the caption. Photos whose generation
  // fails are dropped from the insert — better to ship fewer seeds than
  // to leave a mismatched URL in the queue.
  const photoCount = valid.filter((c) => c.type === 'photo').length;
  const imageFailures: string[] = [];
  if (photoCount > 0) {
    await reportProgress(taskId, {
      phase: 'generating-images',
      target: count,
      progress: valid.length - photoCount,
    });

    let imagesDone = valid.length - photoCount;
    await Promise.all(
      valid.map(async (c, i) => {
        if (c.type !== 'photo') return;
        // Prefer the literal image_brief; caption is now the
        // contributor-voice text, useless as a generation prompt.
        const promptForGen =
          (c.image_brief ?? '').trim() ||
          (c.caption ?? '').trim() ||
          c.content;
        const result = await generatePhotoForCaption({
          caption: promptForGen,
          topicTitle: topic.title,
          topicDescription: topic.description,
        });
        imagesDone += 1;
        await reportProgress(taskId, {
          phase: 'generating-images',
          target: count,
          progress: imagesDone,
        });
        if ('url' in result) {
          valid[i] = { ...c, content: result.url };
        } else {
          imageFailures.push(`#${i + 1}: ${result.error}`);
        }
      })
    );
  }

  // Drop photos whose image generation failed — we don't want to insert
  // contributions with broken Claude-invented URLs.
  const failedPhotoIndices = new Set(
    imageFailures.map((f) => parseInt(f.match(/^#(\d+):/)?.[1] ?? '0', 10) - 1)
  );
  const insertable = valid.filter((_, i) => !failedPhotoIndices.has(i));

  if (insertable.length === 0) {
    return {
      created: 0,
      error: `All photo generations failed: ${imageFailures.join('; ')}`,
    };
  }

  await reportProgress(taskId, {
    phase: 'inserting',
    target: count,
    progress: insertable.length,
  });

  const dates = spreadDates(insertable.length, topic.created_at, topic.deadline);

  const rows = insertable.map((c, i) => ({
    topic_id: topic.id,
    type: c.type,
    contributor_name: c.contributor_name,
    contributor_email: c.contributor_email,
    contributor_location: c.contributor_location || null,
    content: c.content,
    caption: c.caption || null,
    consent_given: true,
    status: 'pending' as const,
    show_publicly: true,
    source: 'studio_seed' as const,
    admin_notes: null,
    created_at: dates[i].toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('topic_contributions')
    .insert(rows);

  if (error) {
    return { created: 0, error: `Database insert failed: ${error.message}` };
  }

  return {
    created: rows.length,
    imageFailures: imageFailures.length ? imageFailures : undefined,
  };
}

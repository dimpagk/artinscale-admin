import { GoogleGenAI } from '@google/genai';
import { uploadFile, getPublicUrl } from '@/lib/storage';

const GEMINI_MODEL = 'gemini-2.5-flash-image';

export interface GeneratePhotoArgs {
  caption: string;
  topicTitle: string;
  topicDescription?: string | null;
}

export type GeneratePhotoResult = { url: string } | { error: string };

function buildPrompt(args: GeneratePhotoArgs): string {
  // The caller is expected to pass an image_brief that already includes
  // the photographic style (Claude picks it per-contribution). We layer
  // on universal constraints only — no text/logos/watermarks — and
  // leave aesthetic decisions to the brief.
  const ctx = args.topicDescription
    ? `\nTopic context (for "${args.topicTitle}"): ${args.topicDescription}.`
    : `\nTopic: "${args.topicTitle}".`;
  return `${args.caption}${ctx}

Universal constraints: no text, logos, or watermarks in the image. Real human subjects only (no obvious AI face artifacts). Vary framing and angle.`;
}

export async function generatePhotoForCaption(
  args: GeneratePhotoArgs
): Promise<GeneratePhotoResult> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    return {
      error: 'GOOGLE_GEMINI_API_KEY missing. Required for image generation.',
    };
  }
  if (!args.caption.trim()) {
    return { error: 'Empty caption — nothing to generate' };
  }

  let imageBase64: string;
  let mimeType = 'image/png';
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: buildPrompt(args) }] }],
    });
    const part = response.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData
    );
    if (!part?.inlineData?.data) {
      return { error: 'Gemini returned no image data' };
    }
    imageBase64 = part.inlineData.data;
    if (part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
  } catch (err) {
    return {
      error: `Gemini call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const buffer = Buffer.from(imageBase64, 'base64');
  const ext = mimeType.split('/')[1] ?? 'png';
  const now = new Date();
  const path = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;

  try {
    await uploadFile('seed-photos', path, buffer, { contentType: mimeType });
  } catch (err) {
    return {
      error: `Storage upload failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { url: getPublicUrl('seed-photos', path) };
}

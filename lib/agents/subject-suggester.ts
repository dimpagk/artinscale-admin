import { callClaude } from './base'

/**
 * Derive a single concrete, depictable subject from a topic's approved
 * community contributions.
 *
 * Used by the art generator when the operator leaves the Subject field
 * blank: the artist (style pack) supplies the visual voice, the topic
 * supplies the context, and this turns that context into the one thing
 * the style pack still needs: a concrete thing to depict. A subject the
 * operator types always wins; this only runs when the field is empty.
 *
 * Returns a short subject phrase with no style words (the style pack
 * owns those), e.g. "a hand cradling drifting smoke".
 */
export async function suggestSubjectFromContext(args: {
  contributionContext: string
  artistTagline?: string | null
}): Promise<string> {
  const text = await callClaude({
    system:
      'You turn community contributions into a single concrete, depictable art subject. ' +
      'Output ONLY the subject as a short noun phrase (3-12 words). No style, medium, ' +
      'palette, mood, or lighting words (those are supplied elsewhere). No quotes, no ' +
      'trailing punctuation, no preamble. Just the subject.',
    user:
      `Community context (themes, stories, and images from contributors):\n${args.contributionContext}\n\n` +
      (args.artistTagline ? `The artist's voice: ${args.artistTagline}\n\n` : '') +
      'Give one concrete subject to depict, drawn from the context above.',
    maxTokens: 100,
  })

  // Claude is told to return only the phrase, but defend against a stray
  // wrapping quote, a leading "Subject:" label, or trailing punctuation.
  return text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^subject:\s*/i, '')
    .replace(/[.\s]+$/, '')
    .trim()
}

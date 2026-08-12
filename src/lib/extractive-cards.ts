import type { LearningCard } from './gemini';

/**
 * Builds learning cards from the document itself, with no model call.
 *
 * This is the graceful fallback PRD §9 asks for, but deliberately NOT the
 * "pre-generated card examples" the PRD suggests as an example: canned cards
 * would violate §5.2's requirement that cards reflect the actual uploaded
 * material rather than generic filler. Extracting real headings and sentences
 * keeps the cards true to the document even when Gemini is unavailable.
 *
 * The trade-off is that the text is lifted from the source rather than
 * rewritten in simpler language, so callers surface this as a degraded mode.
 */

const EMOJI_RULES: [RegExp, string][] = [
  [/\b(algorithm|complexity|big-?o|sort|search|recursion)\b/i, '⚡'],
  [/\b(tree|graph|node|linked list|stack|queue|heap)\b/i, '🌳'],
  [/\b(data|dataset|statistic|probability|distribution)\b/i, '📊'],
  [/\b(network|protocol|tcp|packet|router)\b/i, '🌐'],
  [/\b(security|encryption|cryptograph|attack|threat)\b/i, '🔒'],
  [/\b(database|sql|query|schema|table|index)\b/i, '🗄️'],
  [/\b(memory|process|thread|scheduling|kernel|operating system)\b/i, '⚙️'],
  [/\b(machine learning|neural|model|training|regression)\b/i, '🤖'],
  [/\b(market|finance|cost|revenue|account|econom)\b/i, '💰'],
  [/\b(design|user|interface|usability|prototype)\b/i, '🎨'],
  [/\b(function|derivative|integral|matrix|equation|theorem|proof)\b/i, '🧮'],
];

export function buildExtractiveCards(rawText: string, maxCards = 6): LearningCard[] {
  const blocks = mergeHeadings(
    rawText
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean),
  ).filter((block) => block.split(/\s+/).length >= 12);

  // Some PDFs extract as one undifferentiated blob with no blank lines. Without
  // this, such a document would collapse to a single card.
  const source = blocks.length >= 3 ? blocks : splitIntoSentenceGroups(rawText.trim(), 3);
  const cards: LearningCard[] = [];

  for (const block of source) {
    if (cards.length >= maxCards) break;

    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const { title, body } = splitHeading(lines);
    const content = firstSentences(body, 3);

    if (content.split(/\s+/).length < 10) continue;

    cards.push({
      title: title.slice(0, 70),
      content: content.length > 320 ? `${content.slice(0, 317).trimEnd()}…` : content,
      emoji: pickEmoji(block),
      order_index: cards.length,
    });
  }

  return cards;
}

/** Falls back to grouping consecutive sentences when the text has no structure. */
function splitIntoSentenceGroups(text: string, sentencesPerGroup: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()).filter(Boolean);
  if (!sentences || sentences.length <= sentencesPerGroup) return [text];

  const groups: string[] = [];
  for (let i = 0; i < sentences.length; i += sentencesPerGroup) {
    groups.push(sentences.slice(i, i + sentencesPerGroup).join(' '));
  }
  return groups;
}

/**
 * A standalone heading is separated from its body by a blank line, which would
 * otherwise leave it as a too-short block that gets dropped — taking the real
 * title with it. Attach such blocks to the paragraph that follows.
 */
function mergeHeadings(blocks: string[]): string[] {
  const merged: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const isHeading =
      !block.includes('\n') &&
      block.split(/\s+/).length <= 9 &&
      !/[.!?]$/.test(block) &&
      i + 1 < blocks.length;

    if (isHeading) {
      merged.push(`${block}\n${blocks[i + 1]}`);
      i++; // consumed the body block too
    } else {
      merged.push(block);
    }
  }

  return merged;
}

/**
 * Slide decks usually open with a short heading line. Treat a first line as a
 * title when it is brief and unpunctuated; otherwise synthesise one from the
 * opening words so the card still has a usable label.
 */
function splitHeading(lines: string[]): { title: string; body: string } {
  const [first, ...rest] = lines;
  if (!first) return { title: 'Key concept', body: '' };

  const wordCount = first.split(/\s+/).length;
  const looksLikeHeading = wordCount <= 9 && !/[.!?]$/.test(first) && rest.length > 0;

  if (looksLikeHeading) {
    return { title: stripTrailingColon(first), body: rest.join(' ') };
  }

  const body = lines.join(' ');
  const words = body.split(/\s+/).slice(0, 7).join(' ');
  return { title: stripTrailingColon(words), body };
}

function stripTrailingColon(value: string): string {
  return value.replace(/[:：]\s*$/, '').trim();
}

function firstSentences(text: string, count: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return text.trim();
  return sentences
    .slice(0, count)
    .map((sentence) => sentence.trim())
    .join(' ');
}

function pickEmoji(text: string): string {
  for (const [pattern, emoji] of EMOJI_RULES) {
    if (pattern.test(text)) return emoji;
  }
  return '💡';
}

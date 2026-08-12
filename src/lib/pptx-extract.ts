import JSZip from 'jszip';
import type { ExtractedDocument, ExtractedPage } from './pdf-extract';

/**
 * Extracts text from a PowerPoint deck (PRD §5.1, stretch goal).
 *
 * A .pptx is an OPC package — a ZIP of XML parts. Slide text lives in
 * `ppt/slides/slideN.xml` inside `<a:t>` runs, grouped by `<a:p>` paragraphs.
 * We read those directly rather than pulling in a heavyweight Office parser.
 *
 * Slide numbers come from the filename, which gives the RAG chatbot real
 * "Slide 4" citations rather than opaque section indices.
 */
export async function extractTextFromPPTX(buffer: Buffer): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .map((path) => ({ path, match: /^ppt\/slides\/slide(\d+)\.xml$/.exec(path) }))
    .filter((entry): entry is { path: string; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({ path: entry.path, number: Number(entry.match[1]) }))
    // Filenames sort lexicographically (slide10 before slide2), so sort numerically.
    .sort((a, b) => a.number - b.number);

  if (slideFiles.length === 0) {
    throw new Error('No slides found. That file may not be a valid .pptx presentation.');
  }

  const pages: ExtractedPage[] = [];

  for (const slide of slideFiles) {
    const xml = await zip.file(slide.path)!.async('string');
    const text = extractSlideText(xml);
    if (text) pages.push({ page_number: slide.number, text });
  }

  return {
    text: pages.map((page) => page.text).join('\n\n'),
    pages,
    page_count: slideFiles.length,
    unit: 'slide',
  };
}

/**
 * Pulls text out of one slide's XML. Paragraphs (`<a:p>`) become lines and text
 * runs (`<a:t>`) are concatenated within a paragraph, so a slide title stays on
 * its own line — which downstream heading detection relies on.
 */
function extractSlideText(xml: string): string {
  const paragraphs = xml.split(/<\/a:p>/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const runs = [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)];
    if (runs.length === 0) continue;

    const line = runs.map((run) => decodeXmlEntities(run[1])).join('').replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
  }

  return lines.join('\n').trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Ampersand last, so a literal "&amp;lt;" doesn't become "<".
    .replace(/&amp;/g, '&');
}

import { PDFParse } from 'pdf-parse';

export interface ExtractedPage {
  page_number: number;
  text: string;
}

/**
 * What one `page_number` refers to, so citations can say "Slide 4" vs "Page 4"
 * vs a video timestamp. 'timestamp' is produced by the Video → Notes flow.
 */
export type SourceUnit = 'page' | 'slide' | 'timestamp';

export interface ExtractedDocument {
  text: string;
  pages: ExtractedPage[];
  page_count: number;
  unit: SourceUnit;
}

/**
 * Extracts text from a PDF, preserving page boundaries.
 *
 * Page-level granularity is what lets the RAG chatbot cite "Page 4" instead of
 * an opaque chunk index (PRD §5.3) — so we keep the per-page split rather than
 * flattening to one string up front.
 *
 * Note: pdf-parse v2 exposes a `PDFParse` class; the v1 default-function API
 * (`pdfParse(buffer)`) no longer exists.
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<ExtractedDocument> {
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    // Lecture PDFs frequently have minor structural damage; recover instead of
    // rejecting the whole document.
    stopAtErrors: false,
  });

  try {
    const result = await parser.getText();

    const pages: ExtractedPage[] = result.pages
      .map((page) => ({ page_number: page.num, text: normalizeWhitespace(page.text) }))
      .filter((page) => page.text.length > 0);

    return {
      text: pages.map((page) => page.text).join('\n\n'),
      pages,
      page_count: result.total ?? pages.length,
      unit: 'page',
    };
  } finally {
    // Releases the pdf.js worker; leaking these across uploads exhausts memory.
    await parser.destroy().catch(() => {});
  }
}

/** Wraps pasted plain text in the same shape, treated as a single page. */
export function documentFromPlainText(text: string): ExtractedDocument {
  const normalized = normalizeWhitespace(text);
  return {
    text: normalized,
    pages: normalized ? [{ page_number: 1, text: normalized }] : [],
    page_count: 1,
    unit: 'page',
  };
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

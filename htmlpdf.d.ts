/**
 * htmlpdfx.js — HTML to PDF converter
 * Type declarations for htmlpdf()
 */

// ---------------------------------------------------------------------------
// Font configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a single custom font.
 *
 * Either `fontUrl` or `fontBase64` must be provided.
 */
export interface FontConfig {
  /**
   * CSS font-family name (e.g. `'Roboto'`, `'NotoSansCJK'`).
   * Must match the name used in `data-pdf-font` attributes.
   */
  fontFamily: string;

  /**
   * URL to the `.ttf` / `.otf` font file.
   * Required when `fontBase64` is not provided.
   */
  fontUrl?: string;

  /**
   * Inline Base64-encoded font data.
   * Required when `fontUrl` is not provided.
   */
  fontBase64?: string;

  /**
   * CSS font-weight value: `400`, `700`, `'bold'`, etc.
   * @default 400
   */
  fontWeight?: number | string;

  /**
   * CSS font-style value: `'normal'` or `'italic'`.
   * @default 'normal'
   */
  fontStyle?: 'normal' | 'italic';

  /**
   * If `true`, this font is used for all characters not matched by any
   * `charRanges` font.  Only one font in the array should have this set.
   */
  isDefault?: boolean;

  /**
   * Unicode codepoint ranges this font covers.
   * Each entry is a `[start, end]` pair (inclusive).
   *
   * Example — CJK Unified Ideographs:
   * ```ts
   * charRanges: [[0x4E00, 0x9FFF]]
   * ```
   */
  charRanges?: Array<[number, number]>;
}

// ---------------------------------------------------------------------------
// Table configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a table that needs repeat-header or page-break-border.
 */
export interface TableConfig {
  /**
   * CSS selector identifying the table container element
   * (e.g. `'#my-table'`, `'.report-table'`).
   */
  selector: string;

  /**
   * CSS selector for the header element to repeat on each page
   * (e.g. `'thead'`, `'#my-table-header'`).
   * The header must be a descendant of the element matched by `selector`.
   */
  repeatHeader?: string;

  /**
   * Border style string drawn at the bottom of the table on each page it
   * spans, visually closing the table at the page break.
   *
   * Accepts the same syntax as a CSS border shorthand:
   * `'1px solid #cccccc'`
   */
  pageBreakBorder?: string;
}

// ---------------------------------------------------------------------------
// Header / Footer
// ---------------------------------------------------------------------------

/**
 * Information passed to header/footer render callbacks.
 */
export interface PageRenderInfo {
  /** Current page number (1-based). */
  pageNumber: number;
  /** Total number of pages in the document. */
  totalPages: number;
  /** PDF page width in mm. */
  pageWidth: number;
  /** PDF page height in mm. */
  pageHeight: number;
  /** Page margin in mm. */
  margin: number;
}

/**
 * Header or footer configuration.
 */
export interface HeaderFooterConfig {
  /**
   * Height of the header/footer area in **mm**.
   * This space is reserved from each page's content area.
   */
  height: number;

  /**
   * Render callback invoked once per page.
   *
   * Use the `doc` (jsPDF instance) to draw text, lines, or images.
   *
   * @param doc     - The jsPDF document instance.
   * @param info    - Page information (page number, total pages, dimensions).
   */
  render: (doc: object, info: PageRenderInfo) => void;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** Stage names reported via `onProgress`. */
export type ProgressStage =
  | 'clone'
  | 'images'
  | 'fonts'
  | 'paginate'
  | 'render'
  | 'output';

/** Payload passed to the `onProgress` callback. */
export interface ProgressEvent {
  /** Current pipeline stage. */
  stage: ProgressStage;
  /** Progress value in the range `0.0` – `1.0`. */
  progress: number;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type OutputType = 'blob' | 'dataurl' | 'arraybuffer';

/** Resolves to `Blob` when `output` is `'blob'` (default). */
export function htmlpdf(
  element: HTMLElement,
  options?: HtmlpdfOptions & { output?: 'blob' },
): Promise<Blob>;

/** Resolves to a data URL string when `output` is `'dataurl'`. */
export function htmlpdf(
  element: HTMLElement,
  options: HtmlpdfOptions & { output: 'dataurl' },
): Promise<string>;

/** Resolves to an `ArrayBuffer` when `output` is `'arraybuffer'`. */
export function htmlpdf(
  element: HTMLElement,
  options: HtmlpdfOptions & { output: 'arraybuffer' },
): Promise<ArrayBuffer>;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for `htmlpdf()`.
 */
export interface HtmlpdfOptions {
  /**
   * Output format.
   * @default 'blob'
   */
  output?: OutputType;

  /**
   * PDF page format — any format supported by jsPDF
   * (`'a4'`, `'letter'`, `'a3'`, `'a5'`, `[width, height]`, …).
   * @default 'a4'
   */
  format?: string | [number, number];

  /**
   * Page orientation.
   * @default 'portrait'
   */
  orientation?: 'portrait' | 'landscape';

  /**
   * Page margin in **px** (converted to mm internally using 96 DPI).
   * @default 0
   */
  margin?: number;

  /**
   * Enable PDF compression.
   * @default true
   */
  compress?: boolean;

  /**
   * Custom font configurations.
   * Fonts are fetched and cached by URL for the lifetime of the page.
   */
  fonts?: FontConfig[];

  /**
   * Page header configuration.
   * The `height` value (in mm) is reserved at the top of every page.
   */
  header?: HeaderFooterConfig;

  /**
   * Page footer configuration.
   * The `height` value (in mm) is reserved at the bottom of every page.
   */
  footer?: HeaderFooterConfig;

  /**
   * Table configurations for repeat-header and page-break-border features.
   */
  tables?: TableConfig[];

  /**
   * Print per-stage timing logs to the browser console.
   * @default false
   */
  debug?: boolean;

  /**
   * Progress callback invoked at the end of each pipeline stage.
   *
   * Stages in order: `'clone'` → `'images'` → `'fonts'` →
   * `'paginate'` → `'render'` → `'output'`
   */
  onProgress?: (event: ProgressEvent) => void;
}

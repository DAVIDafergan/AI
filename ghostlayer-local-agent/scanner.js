#!/usr/bin/env node
/**
 * scanner.js – Recursive local file scanner
 *
 * Crawls a directory tree and reads the contents of supported file types:
 *   Plain text : .txt, .md, .csv, .json, .html, .xml, .yaml, .log, .env,
 *                .eml, .rtf, .sql, .sh, .py, .ts, .js, and more
 *   PDF        : .pdf   (via pdf-parse)
 *   Word       : .docx  (via mammoth)
 *   Spreadsheet: .xlsx  (via exceljs)
 *   PowerPoint : .pptx  (via jszip – parses DrawingML slide XML)
 *
 * BLOCKED_EXTENSIONS lists file types that should always be blocked on
 * upload/share regardless of content (executables, archives, certs, media).
 *
 * All processing is local – zero data leaves this machine during the scan phase.
 */

import { readdir, readFile } from "fs/promises";
import { join, extname }     from "path";

// ── Lazily imported parsers (only loaded when the file type is encountered) ───
let _pdfParse = null;
let _mammoth  = null;
let _xlsx     = null;
let _jszip    = null;

async function getPdfParse() {
  if (!_pdfParse) {
    try { _pdfParse = (await import("pdf-parse")).default; } catch { _pdfParse = false; }
  }
  return _pdfParse || null;
}

async function getMammoth() {
  if (!_mammoth) {
    try { _mammoth = (await import("mammoth")).default; } catch { _mammoth = false; }
  }
  return _mammoth || null;
}

async function getXlsx() {
  if (!_xlsx) {
    try { _xlsx = await import("exceljs"); } catch { _xlsx = false; }
  }
  return _xlsx || null;
}

async function getJszip() {
  if (!_jszip) {
    try { _jszip = (await import("jszip")).default; } catch { _jszip = false; }
  }
  return _jszip || null;
}

// Directories to skip during tree traversal.
const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", "__pycache__"]);

// Plain-text formats – read directly as UTF-8.
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".csv", ".json",
  ".html", ".htm", ".xml", ".xhtml",
  ".yaml", ".yml",
  ".log", ".ini", ".conf", ".cfg",
  ".env", ".properties",
  ".eml", ".rtf",
  ".sql", ".sh", ".bash", ".ps1", ".bat", ".cmd",
  ".ts", ".js", ".py", ".rb", ".java", ".cs", ".go", ".rs", ".cpp", ".c", ".h",
]);

// Binary formats that require a dedicated parser.
const BINARY_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".pptx"]);

const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS]);

/**
 * File types that should always be BLOCKED when detected in uploads or shares,
 * regardless of content – either because they carry no scannable text or because
 * they are inherently high-risk (executables, archives, cryptographic material).
 */
export const BLOCKED_EXTENSIONS = new Set([
  // Executables / compiled code
  ".exe", ".dll", ".so", ".dylib", ".bin", ".com", ".msi", ".app",
  // Archives (may contain many files – expand separately if needed)
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".tgz", ".xz",
  // Disk images
  ".iso", ".img", ".dmg", ".vhd", ".vmdk",
  // Cryptographic / credential files
  ".pem", ".key", ".p12", ".pfx", ".jks", ".crt", ".cer", ".der",
  ".htpasswd", ".shadow", ".passwd",
  // Media (no text content)
  ".mp4", ".mp3", ".avi", ".mov", ".mkv", ".flac", ".wav", ".ogg",
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".ico",
]);

// ── File-type parsers ─────────────────────────────────────────────────────────

/** Decode common XML character entities so extracted text is readable. */
function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Extract plain text from a .pptx file.
 * PowerPoint files are ZIP archives; slides live at ppt/slides/slide*.xml.
 * Text is stored in <a:t> elements inside the DrawingML namespace.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function parsePptx(filePath) {
  const JSZip = await getJszip();
  if (!JSZip) return "";
  try {
    const buffer = await readFile(filePath);
    const zip    = await JSZip.loadAsync(buffer);
    const texts  = [];

    const slideKeys = Object.keys(zip.files).filter(
      (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)
    );
    // Sort slides in order (slide1, slide2, …)
    slideKeys.sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
      const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
      return numA - numB;
    });

    for (const key of slideKeys) {
      const xml = await zip.files[key].async("string");
      // Extract all <a:t>…</a:t> text nodes (DrawingML) using a capture group
      // so we never need to strip tags from the matched content.
      const regex = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g;
      let match;
      while ((match = regex.exec(xml)) !== null) {
        const text = decodeXmlEntities(match[1]).trim();
        if (text) texts.push(text);
      }
    }

    return texts.join("\n");
  } catch {
    return "";
  }
}

/**
 * Extract plain text from a PDF file.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function parsePdf(filePath) {
  const pdfParse = await getPdfParse();
  if (!pdfParse) return "";
  try {
    const buffer = await readFile(filePath);
    const data   = await pdfParse(buffer);
    return data.text || "";
  } catch {
    return "";
  }
}

/**
 * Extract plain text from a .docx file.
 * Tables are flattened to tab-separated values so cell content is preserved.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function parseDocx(filePath) {
  const mammoth = await getMammoth();
  if (!mammoth) return "";
  try {
    const buffer = await readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  } catch {
    return "";
  }
}

/**
 * Extract plain text from an .xlsx workbook.
 * Each sheet is serialised as tab-separated values so table cell content
 * is included in the scan (catches sensitive data hidden in spreadsheets).
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function parseXlsx(filePath) {
  const exceljs = await getXlsx();
  if (!exceljs) return "";
  try {
    const workbook = new exceljs.Workbook();
    await workbook.xlsx.readFile(filePath);

    const lines = [];
    workbook.eachSheet((sheet, sheetId) => {
      lines.push(`[Sheet: ${sheet.name}]`);
      sheet.eachRow((row) => {
        const cells = [];
        row.eachCell({ includeEmpty: false }, (cell) => {
          const v = cell.value;
          if (v === null || v === undefined) return;
          // Flatten rich-text and formula results to plain strings
          if (typeof v === "object" && v.richText) {
            cells.push(v.richText.map((r) => r.text || "").join(""));
          } else if (typeof v === "object" && v.result !== undefined) {
            cells.push(String(v.result));
          } else {
            cells.push(String(v));
          }
        });
        if (cells.length) lines.push(cells.join("\t"));
      });
    });

    return lines.join("\n");
  } catch {
    return "";
  }
}

// ── Directory crawler ─────────────────────────────────────────────────────────

/**
 * Recursively collect all supported file paths under `rootDir`.
 *
 * @param {string} rootDir  Absolute or relative directory to crawl.
 * @returns {Promise<string[]>}
 */
async function collectFiles(rootDir) {
  const results = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Skip directories we cannot read (permission errors, broken symlinks, etc.)
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and well-known non-content dirs
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(rootDir);
  return results;
}

/**
 * Read / parse a single file and return its text content.
 * Returns an empty string if the file cannot be read or parsed.
 *
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function readFileContent(filePath) {
  const ext = extname(filePath).toLowerCase();

  if (TEXT_EXTENSIONS.has(ext)) {
    try { return await readFile(filePath, "utf8"); } catch { return ""; }
  }
  if (ext === ".pdf")  return parsePdf(filePath);
  if (ext === ".docx") return parseDocx(filePath);
  if (ext === ".xlsx") return parseXlsx(filePath);
  if (ext === ".pptx") return parsePptx(filePath);
  return "";
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if the given file extension should be auto-blocked
 * (i.e. the file type is inherently high-risk or contains no scannable text).
 *
 * @param {string} ext  File extension including leading dot, e.g. ".exe"
 * @returns {boolean}
 */
export function isBlocked(ext) {
  return BLOCKED_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Scan all supported files under `rootDir` and return an array of
 * `{ path, content }` objects.
 *
 * @param {string} rootDir
 * @param {{ verbose?: boolean }} [options]
 * @returns {Promise<Array<{ path: string, content: string }>>}
 */
export async function scanDirectory(rootDir, options = {}) {
  const { verbose = false } = options;

  if (verbose) {
    console.log(`[scanner] Collecting files under: ${rootDir}`);
    console.log(`[scanner] Supported types: ${[...SUPPORTED_EXTENSIONS].join(", ")}`);
  }

  const filePaths = await collectFiles(rootDir);

  if (verbose) {
    console.log(`[scanner] Found ${filePaths.length} supported file(s).`);
  }

  const files = [];
  for (const filePath of filePaths) {
    const content = await readFileContent(filePath);
    if (content.trim().length > 0) {
      files.push({ path: filePath, content });
    }
    if (verbose) {
      process.stdout.write(`\r[scanner] Reading files… ${files.length}/${filePaths.length}`);
    }
  }

  if (verbose) {
    console.log(); // newline after progress indicator
  }

  return files;
}

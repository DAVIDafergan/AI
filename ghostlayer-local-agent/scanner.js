#!/usr/bin/env node
/**
 * scanner.js – Recursive local file scanner
 *
 * Crawls a directory tree and reads the contents of supported file types:
 *   Plain text : .txt, .md, .csv, .json
 *   PDF        : .pdf   (via pdf-parse)
 *   Word       : .docx  (via mammoth)
 *   Spreadsheet: .xlsx  (via xlsx)
 *
 * All processing is local – zero data leaves this machine during the scan phase.
 */

import { readdir, readFile } from "fs/promises";
import { join, extname }     from "path";

// ── Lazily imported parsers (only loaded when the file type is encountered) ───
let _pdfParse = null;
let _mammoth  = null;
let _xlsx     = null;

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

// Directories to skip during tree traversal.
const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", "__pycache__"]);

const TEXT_EXTENSIONS  = new Set([".txt", ".md", ".csv", ".json"]);
const BINARY_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx"]);
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS]);

// ── File-type parsers ─────────────────────────────────────────────────────────

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
  return "";
}

// ── Public API ────────────────────────────────────────────────────────────────

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

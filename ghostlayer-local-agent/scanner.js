#!/usr/bin/env node
/**
 * scanner.js – Recursive local file scanner
 *
 * Crawls a directory tree and reads the contents of supported file types
 * (.txt, .md, .csv, .json) entirely on the local machine.
 * Zero data leaves this machine during the scan phase.
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, extname } from "path";

/** File extensions we process in v1. */
const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json"]);

/**
 * Recursively collect all supported file paths under `rootDir`.
 *
 * @param {string} rootDir  Absolute or relative directory to crawl.
 * @returns {Promise<string[]>}  List of absolute file paths.
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
        // Skip hidden directories (e.g. .git, .node_modules)
        if (!entry.name.startsWith(".")) {
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
 * Read a single file and return its text content.
 * Returns an empty string if the file cannot be read.
 *
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function readFileContent(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
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

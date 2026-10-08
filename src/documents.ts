/**
 * Filesystem access, sandboxed to the directories the server was started with.
 *
 * Every path an agent passes in goes through `resolveInRoots`, which follows
 * symlinks before checking containment, so `../` tricks and links that point
 * outside the allowed folders are both rejected.
 */
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

export const SUPPORTED_EXTENSIONS = [".pdf", ".txt"] as const;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;
/** Text beyond this is dropped before analysis; invoices are far smaller. */
export const MAX_TEXT_CHARS = 1_000_000;

export class AccessDeniedError extends Error {
  readonly code = "ACCESS_DENIED";
}

export class DocumentReadError extends Error {
  readonly code = "DOCUMENT_READ_ERROR";
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Canonicalize the configured roots once at startup. */
export async function canonicalRoots(dirs: string[]): Promise<string[]> {
  return Promise.all(dirs.map((d) => realpath(path.resolve(d))));
}

/**
 * Resolve `input` (absolute, or relative to the first root) and verify it lives
 * inside one of `roots`. For paths that don't exist yet (an export target),
 * the parent directory is checked instead.
 */
const NOT_ALLOWED = "Not found, or outside the allowed folders. Paths are relative to the first allowed folder; use scan_folder to see what is available.";

export async function resolveInRoots(roots: string[], input: string, opts: { mustExist?: boolean } = {}): Promise<string> {
  const mustExist = opts.mustExist ?? true;
  const candidate = path.resolve(roots[0]!, input);
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    // Same message as an access denial, so callers can't probe what exists outside the roots.
    if (mustExist) throw new AccessDeniedError(NOT_ALLOWED);
    real = path.join(await realpath(path.dirname(candidate)).catch(() => path.dirname(candidate)), path.basename(candidate));
  }
  if (!roots.some((r) => isInside(r, real))) {
    throw new AccessDeniedError(NOT_ALLOWED);
  }
  return real;
}

export interface DocumentEntry {
  path: string;
  name: string;
  extension: string;
  size_bytes: number;
  modified: string;
}

const isSupported = (name: string) => (SUPPORTED_EXTENSIONS as readonly string[]).includes(path.extname(name).toLowerCase());

/** List supported documents under `dir`, sorted by path. Hidden files are skipped. */
export async function listDocuments(dir: string, opts: { recursive: boolean }): Promise<DocumentEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: opts.recursive });
  const files = entries.filter((e) => e.isFile() && !e.name.startsWith(".") && isSupported(e.name));
  const out = await Promise.all(
    files.map(async (e) => {
      const full = path.join(e.parentPath, e.name);
      const s = await stat(full);
      return {
        path: full,
        name: e.name,
        extension: path.extname(e.name).toLowerCase(),
        size_bytes: s.size,
        modified: s.mtime.toISOString(),
      };
    }),
  );
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export interface DocumentText {
  text: string;
  pages: number;
  /** False for scanned PDFs with no text layer — they need OCR first. */
  has_text_layer: boolean;
}

export async function readDocumentText(file: string): Promise<DocumentText> {
  const ext = path.extname(file).toLowerCase();
  if (!isSupported(file)) throw new DocumentReadError(`Unsupported file type "${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`);
  const s = await stat(file);
  if (s.size > MAX_FILE_BYTES) throw new DocumentReadError(`File is ${s.size} bytes; the limit is ${MAX_FILE_BYTES}`);

  const buf = await readFile(file);
  if (ext === ".txt") {
    const text = buf.toString("utf8").slice(0, MAX_TEXT_CHARS);
    return { text, pages: 1, has_text_layer: text.trim().length > 0 };
  }
  return readPdfText(buf, path.basename(file));
}

async function readPdfText(buf: Buffer, name: string): Promise<DocumentText> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf));
    if (pdf.numPages > MAX_PDF_PAGES) throw new DocumentReadError(`${name} has ${pdf.numPages} pages; the limit is ${MAX_PDF_PAGES}`);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const joined = text.join("\n\n").slice(0, MAX_TEXT_CHARS);
    return { text: joined, pages: totalPages, has_text_layer: joined.replace(/\s/g, "").length > 20 };
  } catch (err) {
    if (err instanceof DocumentReadError) throw err;
    throw new DocumentReadError(`Could not parse PDF ${name}`);
  } finally {
    // Free the worker-side document; pdf.js keeps it alive otherwise.
    await pdf?.loadingTask.destroy();
  }
}

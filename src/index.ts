#!/usr/bin/env node
/**
 * stdio entry point.
 *
 *   facturas-inbox-mcp <folder> [more folders...]
 *   facturas-inbox-mcp --demo        (serves the bundled synthetic sample inbox)
 *
 * Folders can also come from FACTURAS_INBOX_DIRS (separated like PATH).
 * stdout carries the MCP protocol only; all logging goes to stderr.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { canonicalRoots } from "./documents.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

/** The synthetic sample inbox shipped with the package (dist/../examples/inbox). */
const DEMO_INBOX = fileURLToPath(new URL("../examples/inbox", import.meta.url));

const USAGE = `Usage: ${SERVER_NAME} <folder> [more folders...]
       ${SERVER_NAME} --demo

--demo serves the bundled synthetic sample inbox (11 fictional documents;
the business's tax ID is B87654323).

Serves the Model Context Protocol over stdio. The server can only read (and
export CSVs into) the folders you pass. Folders may also be given in the
FACTURAS_INBOX_DIRS environment variable, separated by "${path.delimiter}".`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) return void console.error(USAGE);
  if (args.includes("--version")) return void console.error(SERVER_VERSION);

  const fromEnv = (process.env.FACTURAS_INBOX_DIRS ?? "").split(path.delimiter).filter(Boolean);
  const dirs = args.includes("--demo") ? [DEMO_INBOX] : args.length > 0 ? args : fromEnv;
  if (dirs.length === 0) {
    console.error(`${USAGE}\n\nError: no folders given.`);
    process.exit(1);
  }
  for (const d of dirs) {
    const s = await stat(d).catch(() => null);
    if (!s?.isDirectory()) {
      console.error(`Error: not a directory: ${d}`);
      process.exit(1);
    }
  }
  const roots = await canonicalRoots(dirs);
  await serveStdio(() => createServer(roots));
  console.error(`${SERVER_NAME} ${SERVER_VERSION} on stdio; allowed folders: ${roots.join(", ")}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

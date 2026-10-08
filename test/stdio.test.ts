/**
 * End-to-end over real stdio against the built binary (`npm run build` first).
 * Any stray console.log on stdout would corrupt the JSON-RPC stream and fail this test.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, it } from "vitest";
import { INBOX, OWN_TAX_ID } from "./helpers.js";

const BIN = path.resolve(import.meta.dirname, "../dist/index.js");

it.skipIf(!existsSync(BIN))("serves tools over stdio from the built binary", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, INBOX], stderr: "ignore" });
  const client = new Client({ name: "stdio-e2e", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
    const r = (await client.callTool({ name: "vat_summary", arguments: { own_tax_id: OWN_TAX_ID, quarter: "2026-Q3" } })) as {
      structuredContent?: { net_vat: number };
    };
    expect(r.structuredContent?.net_vat).toBe(243);
  } finally {
    await client.close();
  }
}, 30_000);

it.skipIf(!existsSync(BIN))("--demo serves the bundled sample inbox", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, "--demo"], stderr: "ignore" });
  const client = new Client({ name: "stdio-demo", version: "0.0.0" });
  await client.connect(transport);
  try {
    const r = (await client.callTool({ name: "scan_folder", arguments: {} })) as { structuredContent?: { total_documents: number } };
    expect(r.structuredContent?.total_documents).toBe(11);
  } finally {
    await client.close();
  }
}, 30_000);

import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { canonicalRoots } from "../src/documents.js";
import { createServer } from "../src/server.js";

export const INBOX = path.resolve(import.meta.dirname, "../examples/inbox");
/** Tax ID of the fictional business that owns the sample inbox. */
export const OWN_TAX_ID = "B87654323";

export async function connect(dirs: string[] = [INBOX]) {
  const roots = await canonicalRoots(dirs);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(roots);
  const client = new Client({ name: "test", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    roots,
    /** Call a tool and return structuredContent (or the error text). */
    async call(name: string, args: Record<string, unknown> = {}) {
      const r = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        structuredContent?: Record<string, any>;
        content: { type: string; text: string }[];
      };
      return { isError: r.isError === true, data: r.structuredContent as Record<string, any>, text: r.content[0]?.text ?? "" };
    },
    close: () => client.close(),
  };
}

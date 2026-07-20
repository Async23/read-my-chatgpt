import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type BackendMode = "normal" | "no-matches" | "invalid-json";

type ToolPayload = {
  error?: string;
  status?: number | null;
  conversation_id?: string;
  message_count?: number;
  messages?: Array<{ role?: string; content?: string }>;
  has_more?: boolean;
  hits?: Array<{ conversation_id: string }>;
  scanned?: number;
  scan_cap?: number;
};

function parseToolPayload(result: Awaited<ReturnType<Client["callTool"]>>) {
  assert.ok(Array.isArray(result.content));
  const first: unknown = result.content[0];
  assert.ok(first && typeof first === "object");
  assert.ok("type" in first && first.type === "text");
  assert.ok("text" in first && typeof first.text === "string");
  return JSON.parse(first.text) as ToolPayload;
}

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

test("MCP tools preserve archive, pagination, and upstream error semantics", async (t) => {
  let mode: BackendMode = "normal";
  const requestedArchiveFlags: string[] = [];
  let singularDetailRequests = 0;

  const backend = http.createServer(async (request, response) => {
    if (mode === "invalid-json") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html>login</html>");
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname.startsWith("/backend-api/conversation/")) {
      singularDetailRequests += 1;
      assert.equal(request.method, "GET");
      assert.equal(url.pathname, "/backend-api/conversation/detail-via-xhr");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          conversation_id: "detail-via-xhr",
          title: "Detail through the read-only endpoint",
          current_node: "a1",
          mapping: {
            root: {
              id: "root",
              parent: null,
              children: ["u1"],
              message: null,
            },
            u1: {
              id: "u1",
              parent: "root",
              children: ["a1"],
              message: {
                id: "u1",
                author: { role: "user" },
                content: { content_type: "text", parts: ["Question"] },
              },
            },
            a1: {
              id: "a1",
              parent: "u1",
              children: [],
              message: {
                id: "a1",
                author: { role: "assistant" },
                content: { content_type: "text", parts: ["Answer"] },
              },
            },
          },
        }),
      );
      return;
    }

    assert.equal(url.pathname, "/backend-api/conversations");
    const archiveFlag = url.searchParams.get("is_archived") ?? "unset";
    requestedArchiveFlags.push(archiveFlag);
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset"));

    if (mode === "no-matches") {
      const items = Array.from({ length: limit }, (_, index) => ({
        id: `${archiveFlag}-${offset + index}`,
        title: "Unrelated title",
        update_time: 1_000 - offset - index,
        is_archived: archiveFlag === "true",
      }));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          items,
          total: 1_000,
          offset,
          limit,
        }),
      );
      return;
    }

    const items =
      archiveFlag === "true"
        ? [
            {
              id: "archived",
              title: "Needle archived",
              update_time: 100,
              is_archived: true,
            },
          ]
        : [
            {
              id: "active",
              title: "Needle active",
              update_time: 200,
              is_archived: false,
            },
          ];

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        items,
        total: limit === 2 ? 2 : 1,
        offset: 0,
        limit,
      }),
    );
  });

  await new Promise<void>((resolve) =>
    backend.listen(0, "127.0.0.1", resolve),
  );
  const address = backend.address();
  assert.ok(address && typeof address === "object");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    cwd: process.cwd(),
    env: {
      ...inheritedEnvironment(),
      READ_MY_CHATGPT_ACCESS_TOKEN: "test-token",
      READ_MY_CHATGPT_BASE_URL: `http://127.0.0.1:${address.port}`,
      READ_MY_CHATGPT_TRANSPORT: "direct",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "regression-test", version: "1.0.0" });

  try {
    await client.connect(transport);

    await t.test(
      "get_conversation uses the singular read-only detail endpoint",
      async () => {
        const result = await client.callTool({
          name: "get_conversation",
          arguments: {
            conversation_id: "detail-via-xhr",
            max_messages: 30,
          },
        });
        const payload = parseToolPayload(result);
        assert.notEqual(result.isError, true);
        assert.equal(payload.conversation_id, "detail-via-xhr");
        assert.equal(payload.message_count, 2);
        assert.deepEqual(
          payload.messages?.map((message) => message.role),
          ["user", "assistant"],
        );
        assert.equal(singularDetailRequests, 1);
      },
    );

    await t.test(
      "include_archived searches active and archived conversations",
      async () => {
        requestedArchiveFlags.length = 0;
        const result = await client.callTool({
          name: "search_conversations",
          arguments: { query: "needle", include_archived: true },
        });
        const payload = parseToolPayload(result);
        assert.deepEqual(
          payload.hits
            ?.map((hit) => hit.conversation_id)
            .sort(),
          ["active", "archived"],
        );
        assert.deepEqual(
          [...new Set(requestedArchiveFlags)].sort(),
          ["false", "true"],
        );
      },
    );

    await t.test(
      "applies the hit limit after considering both archive scopes",
      async () => {
        requestedArchiveFlags.length = 0;
        const result = await client.callTool({
          name: "search_conversations",
          arguments: {
            query: "needle",
            include_archived: true,
            limit: 1,
          },
        });
        const payload = parseToolPayload(result);
        assert.deepEqual(
          payload.hits?.map((hit) => hit.conversation_id),
          ["active"],
        );
        assert.deepEqual(
          [...new Set(requestedArchiveFlags)].sort(),
          ["false", "true"],
        );
      },
    );

    await t.test("has_more honors an exact upstream total", async () => {
      const result = await client.callTool({
        name: "list_conversations",
        arguments: { limit: 1 },
      });
      const payload = parseToolPayload(result);
      assert.equal(payload.has_more, false);
    });

    await t.test("has_more detects a partial page with remaining items", async () => {
      const result = await client.callTool({
        name: "list_conversations",
        arguments: { limit: 2 },
      });
      const payload = parseToolPayload(result);
      assert.equal(payload.has_more, true);
    });

    await t.test("combined archive search respects the scan cap", async () => {
      mode = "no-matches";
      requestedArchiveFlags.length = 0;
      const result = await client.callTool({
        name: "search_conversations",
        arguments: { query: "needle", include_archived: true },
      });
      const payload = parseToolPayload(result);
      assert.deepEqual(payload.hits, []);
      assert.equal(payload.scanned, 200);
      assert.equal(payload.scan_cap, 200);
      assert.deepEqual(
        [...new Set(requestedArchiveFlags)].sort(),
        ["false", "true"],
      );
    });

    await t.test(
      "malformed successful responses remain upstream API errors",
      async () => {
        mode = "invalid-json";
        const result = await client.callTool({
          name: "list_conversations",
          arguments: {},
        });
        const payload = parseToolPayload(result);
        assert.equal(result.isError, true);
        assert.equal(payload.error, "chatgpt_api_error");
        assert.equal(payload.status, 200);
      },
    );
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      backend.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

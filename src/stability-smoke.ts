/**
 * Repeated live probe against one persistent Obscura session.
 *
 *   npm run smoke:stability
 *   READ_MY_CHATGPT_STABILITY_ITERATIONS=20 npm run smoke:stability
 */
import { setTimeout as delay } from "node:timers/promises";
import { ChatGPTClient } from "./chatgpt-client.js";
import { loadConfig } from "./config.js";
import { createChatGPTTransport } from "./transport/create-transport.js";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const config = loadConfig();
  const iterations = positiveInteger(
    process.env.READ_MY_CHATGPT_STABILITY_ITERATIONS,
    5,
  );
  const intervalMs = positiveInteger(
    process.env.READ_MY_CHATGPT_STABILITY_INTERVAL_MS,
    1_000,
  );
  const transport = await createChatGPTTransport(config);
  const client = new ChatGPTClient(transport);
  const durations: number[] = [];

  try {
    for (let attempt = 1; attempt <= iterations; attempt += 1) {
      const startedAt = performance.now();
      const list = await client.listConversations({
        offset: 0,
        limit: 1,
        order: "updated",
      });
      const conversationId = list.items?.[0]?.id;
      let mappingNodeCount: number | null = null;
      if (conversationId) {
        const detail = await client.getConversation(conversationId);
        mappingNodeCount = detail.mapping
          ? Object.keys(detail.mapping).length
          : 0;
      }
      const durationMs = Math.round(performance.now() - startedAt);
      durations.push(durationMs);
      console.error(
        JSON.stringify({
          attempt,
          ok: true,
          duration_ms: durationMs,
          list_item_count: list.items?.length ?? 0,
          detail_mapping_node_count: mappingNodeCount,
        }),
      );

      if (attempt < iterations) await delay(intervalMs);
    }
  } finally {
    await client.close();
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        iterations,
        min_duration_ms: Math.min(...durations),
        max_duration_ms: Math.max(...durations),
        average_duration_ms: Math.round(
          durations.reduce((sum, value) => sum + value, 0) /
            durations.length,
        ),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

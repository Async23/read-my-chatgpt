/**
 * Manual smoke test (not MCP): list → optional get.
 *
 *   READ_MY_CHATGPT_ACCESS_TOKEN=... npm run smoke
 *   READ_MY_CHATGPT_ACCESS_TOKEN=... npm run smoke -- <conversation_id>
 */
import { ChatGPTClient } from "./chatgpt-client.js";
import { loadConfig } from "./config.js";
import { createChatGPTTransport } from "./transport/create-transport.js";
import { activeBranchTranscript } from "./transcript.js";

async function main() {
  const config = loadConfig();
  const transport = await createChatGPTTransport(config);
  const client = new ChatGPTClient(transport);

  try {
    const conversationId = process.argv[2];

    console.error("Listing conversations...");
    const list = await client.listConversations({ offset: 0, limit: 5 });
    console.log(
      JSON.stringify(
        {
          count: list.items?.length ?? 0,
          items: (list.items ?? []).map((i) => ({
            id: i.id,
            title: i.title,
            update_time: i.update_time,
          })),
        },
        null,
        2,
      ),
    );

    const id = conversationId ?? list.items?.[0]?.id;
    if (!id) {
      console.error("No conversation to fetch.");
      return;
    }

    console.error(`Fetching conversation ${id}...`);
    const detail = await client.getConversation(id);
    const transcript = activeBranchTranscript(detail, {
      maxMessages: config.defaultMaxMessages,
    });
    console.log(JSON.stringify(transcript, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

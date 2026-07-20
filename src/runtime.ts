import { ChatGPTClient } from "./chatgpt-client.js";
import type { Config } from "./config.js";
import { SERVICE_NAME } from "./install-paths.js";
import { createReadMyChatGptMcpServer } from "./mcp-server.js";
import { createChatGPTTransport } from "./transport/create-transport.js";

/**
 * Process-wide ownership boundary.
 *
 * Every MCP connection gets its own protocol server, while all connections
 * share this runtime's single ChatGPT client and single upstream transport.
 */
export class ReadMyChatGptRuntime {
  private closed = false;

  private constructor(
    readonly config: Config,
    private readonly client: ChatGPTClient,
  ) {}

  static async create(config: Config): Promise<ReadMyChatGptRuntime> {
    const transport = await createChatGPTTransport(config);
    return new ReadMyChatGptRuntime(
      config,
      new ChatGPTClient(transport),
    );
  }

  createMcpServer() {
    if (this.closed) {
      throw new Error(`${SERVICE_NAME} runtime is closed`);
    }
    return createReadMyChatGptMcpServer(this.config, this.client);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.client.close();
  }
}

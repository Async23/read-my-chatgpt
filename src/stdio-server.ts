import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ReadMyChatGptRuntime } from "./runtime.js";

export type RunningMcpServer = {
  close(): Promise<void>;
};

export async function startStdioMcpServer(
  runtime: ReadMyChatGptRuntime,
): Promise<RunningMcpServer> {
  const server = runtime.createMcpServer();
  const transport = new StdioServerTransport();
  let closePromise: Promise<void> | undefined;

  const close = (): Promise<void> => {
    if (!closePromise) {
      // Defer teardown by one microtask so closePromise is assigned before
      // the SDK synchronously invokes transport.onclose from server.close().
      closePromise = Promise.resolve().then(async () => {
        await Promise.allSettled([server.close(), runtime.close()]);
      });
    }
    return closePromise;
  };

  transport.onclose = () => {
    void close();
  };
  process.stdin.once("end", () => {
    void close();
  });

  try {
    await server.connect(transport);
  } catch (error) {
    await runtime.close();
    throw error;
  }

  return { close };
}

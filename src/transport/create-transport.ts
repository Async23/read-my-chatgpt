import type { Config } from "../config.js";
import { SERVICE_NAME } from "../install-paths.js";
import { ensureObscuraBinary } from "../obscura-installer.js";
import type { ChatGPTTransport } from "./chatgpt-transport.js";
import { DirectChatGPTTransport } from "./direct-transport.js";
import { ObscuraChatGPTTransport } from "./obscura-transport.js";

export async function createChatGPTTransport(
  config: Config,
): Promise<ChatGPTTransport> {
  if (config.transport === "direct") {
    return new DirectChatGPTTransport(config.accessToken, config.baseUrl);
  }

  if (config.obscuraCdpUrl) {
    return ObscuraChatGPTTransport.connect({
      accessToken: config.accessToken,
      baseUrl: config.baseUrl,
      cdpUrl: config.obscuraCdpUrl,
    });
  }

  const binaryPath = await ensureObscuraBinary({
    explicitBinary: config.obscuraBinary,
    log: (message) =>
      console.error(`[${SERVICE_NAME}] ${message}`),
  });
  return ObscuraChatGPTTransport.launch({
    accessToken: config.accessToken,
    baseUrl: config.baseUrl,
    binaryPath,
    storageDir: config.obscuraStorageDir,
    timezone: config.obscuraTimezone,
  });
}

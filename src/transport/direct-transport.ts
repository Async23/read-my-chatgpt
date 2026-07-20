import type {
  ChatGPTTransport,
  TransportResponse,
} from "./chatgpt-transport.js";
import { SERVICE_NAME } from "../install-paths.js";
import { PACKAGE_VERSION } from "../version.js";

export class DirectChatGPTTransport implements ChatGPTTransport {
  private static readonly requestTimeoutMs = 20_000;

  constructor(
    private readonly accessToken: string,
    private readonly baseUrl: string,
  ) {}

  get(path: string): Promise<TransportResponse> {
    return this.request(path);
  }

  async close(): Promise<void> {}

  private async request(
    path: string,
  ): Promise<TransportResponse> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        "User-Agent": `${SERVICE_NAME}/${PACKAGE_VERSION}`,
      },
      signal: AbortSignal.timeout(
        DirectChatGPTTransport.requestTimeoutMs,
      ),
    });

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  }
}

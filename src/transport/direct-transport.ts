import type {
  BinaryTransportResponse,
  ChatGPTTransport,
  TransportResponse,
} from "./chatgpt-transport.js";
import { assertAllowedAssetUrl } from "./asset-url.js";
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

  async getBinary(
    url: string,
    maxBytes: number,
  ): Promise<BinaryTransportResponse> {
    const target = assertAllowedAssetUrl(this.baseUrl, url);
    const sameOrigin = target.origin === new URL(this.baseUrl).origin;
    const headers: Record<string, string> = {
      Accept: "*/*",
      "User-Agent": `${SERVICE_NAME}/${PACKAGE_VERSION}`,
    };
    if (sameOrigin) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    let response: Response;
    try {
      response = await fetch(target, {
        method: "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(
          DirectChatGPTTransport.requestTimeoutMs,
        ),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "NetworkError";
      throw new Error(`Asset download failed (${name})`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await response.body?.cancel();
      throw new Error(`Asset exceeds the ${maxBytes} byte limit`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: new Uint8Array(),
      };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`Asset exceeds the ${maxBytes} byte limit`);
        }
        chunks.push(value);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Asset exceeds")
      ) {
        throw error;
      }
      const name = error instanceof Error ? error.name : "NetworkError";
      throw new Error(`Asset download failed (${name})`);
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
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

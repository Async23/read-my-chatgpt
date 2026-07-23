import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatGPTApiError,
  ChatGPTChallengeError,
  ChatGPTClient,
  ChatGPTTimeoutError,
} from "../src/chatgpt-client.js";
import type {
  BinaryTransportResponse,
  ChatGPTTransport,
  TransportResponse,
} from "../src/transport/chatgpt-transport.js";

class StaticTransport implements ChatGPTTransport {
  constructor(private readonly response: TransportResponse) {}

  async get(): Promise<TransportResponse> {
    return this.response;
  }

  async getBinary(): Promise<BinaryTransportResponse> {
    throw new Error("Unexpected binary request");
  }

  async close(): Promise<void> {}
}

class TimeoutThenSuccessTransport implements ChatGPTTransport {
  getCalls = 0;

  constructor(private readonly timeoutsBeforeSuccess = 1) {}

  async get(): Promise<TransportResponse> {
    this.getCalls += 1;
    if (this.getCalls <= this.timeoutsBeforeSuccess) {
      const error = new Error("ChatGPT request timed out");
      error.name = "TimeoutError";
      throw error;
    }
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_id: "retry-me",
        current_node: null,
        mapping: {},
      }),
    };
  }

  async getBinary(): Promise<BinaryTransportResponse> {
    throw new Error("Unexpected binary request");
  }

  async close(): Promise<void> {}
}

class FileTransport implements ChatGPTTransport {
  requestedPath = "";
  requestedBinaryUrl = "";

  constructor(private readonly failBinary = false) {}

  async get(path: string): Promise<TransportResponse> {
    this.requestedPath = path;
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "success",
        download_url: "https://files.example.com/image?signature=secret",
        file_name: "image.png",
        mime_type: "image/png",
      }),
    };
  }

  async getBinary(url: string): Promise<BinaryTransportResponse> {
    this.requestedBinaryUrl = url;
    if (this.failBinary) {
      throw new Error(`failed for ${url}`);
    }
    return {
      status: 200,
      headers: { "content-type": "image/png" },
      body: Uint8Array.from([137, 80, 78, 71]),
    };
  }

  async close(): Promise<void> {}
}

test("classifies Cloudflare challenge responses separately from expired auth", async () => {
  const client = new ChatGPTClient(
    new StaticTransport({
      status: 403,
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "cf-mitigated": "challenge",
      },
      body: "<html><title>Just a moment...</title></html>",
    }),
  );

  await assert.rejects(
    () => client.listConversations(),
    (error) =>
      error instanceof ChatGPTChallengeError &&
      error.code === "cloudflare_challenge",
  );
});

test("classifies malformed successful responses as ChatGPT API errors", async () => {
  const client = new ChatGPTClient(
    new StaticTransport({
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html>login</html>",
    }),
  );

  await assert.rejects(
    () => client.listConversations(),
    (error) =>
      error instanceof ChatGPTApiError &&
      error.status === 200 &&
      error.code === "chatgpt_api_error",
  );
});

test("retries one timed-out detail request", async () => {
  const transport = new TimeoutThenSuccessTransport();
  const client = new ChatGPTClient(transport);

  const detail = await client.getConversation("retry-me");

  assert.equal(detail.conversation_id, "retry-me");
  assert.equal(transport.getCalls, 2);
});

test("surfaces repeated transport timeouts with a stable error code", async () => {
  const transport = new TimeoutThenSuccessTransport(2);
  const client = new ChatGPTClient(transport);

  await assert.rejects(
    () => client.getConversation("still-slow"),
    (error) =>
      error instanceof ChatGPTTimeoutError &&
      error.code === "upstream_timeout",
  );
});

test("downloads conversation files without returning the signed URL", async () => {
  const transport = new FileTransport();
  const client = new ChatGPTClient(transport);

  const file = await client.downloadConversationFile(
    "conversation/id",
    "file_image",
    100,
  );

  assert.equal(
    transport.requestedPath,
    "/backend-api/files/download/file_image?conversation_id=conversation%2Fid&inline=false",
  );
  assert.match(transport.requestedBinaryUrl, /signature=secret/);
  assert.equal(file.fileName, "image.png");
  assert.equal(file.declaredMimeType, "image/png");
  assert.equal("download_url" in file, false);
});

test("redacts signed asset URLs from download errors", async () => {
  const client = new ChatGPTClient(new FileTransport(true));

  await assert.rejects(
    () => client.downloadConversationFile("conversation", "file_image", 100),
    (error) => {
      assert.ok(error instanceof ChatGPTApiError);
      assert.equal(
        error.message,
        "Network error downloading a ChatGPT conversation asset (Error)",
      );
      return true;
    },
  );
});

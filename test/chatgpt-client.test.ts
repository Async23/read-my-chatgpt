import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatGPTApiError,
  ChatGPTChallengeError,
  ChatGPTClient,
  ChatGPTTimeoutError,
} from "../src/chatgpt-client.js";
import type {
  ChatGPTTransport,
  TransportResponse,
} from "../src/transport/chatgpt-transport.js";

class StaticTransport implements ChatGPTTransport {
  constructor(private readonly response: TransportResponse) {}

  async get(): Promise<TransportResponse> {
    return this.response;
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

import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, loadConfig } from "../src/config.js";

test("uses an owned Obscura sidecar by default", () => {
  const config = loadConfig({
    READ_MY_CHATGPT_ACCESS_TOKEN: "test-token",
  });

  assert.equal(config.transport, "obscura");
  assert.equal(config.mcpTransport, "stdio");
  assert.equal(config.mcpHost, "127.0.0.1");
  assert.equal(config.mcpPort, 47831);
  assert.equal(config.mcpSessionIdleMs, 1_800_000);
  assert.equal(config.obscuraBinary, undefined);
  assert.equal(config.obscuraCdpUrl, undefined);
});

test("rejects unknown ChatGPT transports", () => {
  assert.throws(
    () =>
      loadConfig({
        READ_MY_CHATGPT_ACCESS_TOKEN: "test-token",
        READ_MY_CHATGPT_TRANSPORT: "unknown",
      }),
    (error) =>
      error instanceof ConfigError && error.code === "config_error",
  );
});

test("rejects a non-loopback Obscura CDP endpoint", () => {
  assert.throws(
    () =>
      loadConfig({
        READ_MY_CHATGPT_ACCESS_TOKEN: "test-token",
        READ_MY_CHATGPT_OBSCURA_CDP_URL: "ws://example.com/devtools/browser",
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message.includes("loopback"),
  );
});

test("loads a loopback HTTP MCP endpoint", () => {
  const config = loadConfig({
    READ_MY_CHATGPT_ACCESS_TOKEN: "test-token",
    READ_MY_CHATGPT_MCP_TRANSPORT: "http",
    READ_MY_CHATGPT_MCP_HOST: "localhost",
    READ_MY_CHATGPT_MCP_PORT: "43123",
    READ_MY_CHATGPT_MCP_BEARER_TOKEN: "mcp-secret",
  });

  assert.equal(config.mcpTransport, "http");
  assert.equal(config.mcpHost, "localhost");
  assert.equal(config.mcpPort, 43123);
  assert.equal(config.mcpBearerToken, "mcp-secret");
});

test("rejects a non-loopback HTTP MCP endpoint", () => {
  assert.throws(
    () =>
      loadConfig({
        READ_MY_CHATGPT_ACCESS_TOKEN: "test-token",
        READ_MY_CHATGPT_MCP_TRANSPORT: "http",
        READ_MY_CHATGPT_MCP_HOST: "0.0.0.0",
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message.includes("loopback"),
  );
});

test("rejects an invalid HTTP MCP port", () => {
  assert.throws(
    () =>
      loadConfig({
        READ_MY_CHATGPT_ACCESS_TOKEN: "test-token",
        READ_MY_CHATGPT_MCP_PORT: "65536",
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message.includes("1 to 65535"),
  );
});

test("rejects an unsafe HTTP MCP session idle timeout", () => {
  assert.throws(
    () =>
      loadConfig({
        READ_MY_CHATGPT_ACCESS_TOKEN: "test-token",
        READ_MY_CHATGPT_MCP_SESSION_IDLE_MS: "999",
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message.includes("at least 1000"),
  );
});

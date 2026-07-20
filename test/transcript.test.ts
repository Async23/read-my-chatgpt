import assert from "node:assert/strict";
import test from "node:test";
import { activeBranchTranscript } from "../src/transcript.js";
import type { ConversationDetail } from "../src/chatgpt-client.js";

function node(
  id: string,
  parent: string | null,
  role: string,
  text: string,
  children: string[] = [],
) {
  return {
    id,
    parent,
    children,
    message: {
      id,
      author: { role },
      create_time: 1700000000,
      content: { content_type: "text", parts: [text] },
    },
  };
}

test("returns only the active conversation branch", () => {
  const detail: ConversationDetail = {
    conversation_id: "c1",
    title: "Test chat",
    create_time: 1700000000,
    update_time: 1700001000,
    current_node: "a2",
    mapping: {
      root: { id: "root", parent: null, children: ["u1"], message: null },
      u1: node("u1", "root", "user", "Hello", ["a1", "a2"]),
      a1: node("a1", "u1", "assistant", "Old branch answer", []),
      a2: node("a2", "u1", "assistant", "Active branch answer", []),
    },
  };

  const transcript = activeBranchTranscript(detail);
  assert.equal(transcript.branch, "active");
  assert.equal(transcript.messages.length, 2);
  assert.equal(transcript.messages[0]?.content, "Hello");
  assert.equal(transcript.messages[1]?.content, "Active branch answer");
  assert.ok(
    !transcript.messages.some((message) =>
      message.content.includes("Old branch"),
    ),
  );
});

test("preserves meaningful leading and trailing message whitespace", () => {
  const text = "    indented code\n";
  const detail: ConversationDetail = {
    conversation_id: "c1",
    current_node: "u1",
    mapping: {
      u1: node("u1", null, "user", text),
    },
  };

  const transcript = activeBranchTranscript(detail);
  assert.equal(transcript.messages[0]?.content, text);
});

test("still omits messages whose content is only whitespace", () => {
  const detail: ConversationDetail = {
    conversation_id: "c1",
    current_node: "u1",
    mapping: {
      u1: node("u1", null, "user", "   \n"),
    },
  };

  const transcript = activeBranchTranscript(detail);
  assert.deepEqual(transcript.messages, []);
});

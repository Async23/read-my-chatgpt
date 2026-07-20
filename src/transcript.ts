import type { ConversationDetail, ConversationMessageNode } from "./chatgpt-client.js";

export type TranscriptMessage = {
  role: string;
  content: string;
  created_at: string | null;
  message_id: string | null;
};

export type ActiveTranscript = {
  conversation_id: string;
  title: string;
  updated_at: string | null;
  created_at: string | null;
  branch: "active";
  message_count: number;
  truncated: boolean;
  messages: TranscriptMessage[];
};

function isoFromUnix(ts: number | null | undefined): string | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  // ChatGPT sometimes returns seconds, sometimes ms-ish; treat large values as ms.
  const ms = ts > 1e12 ? ts : ts * 1000;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function partsToText(parts: unknown[] | undefined): string {
  if (!parts?.length) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      chunks.push(part);
      continue;
    }
    if (part && typeof part === "object") {
      const obj = part as Record<string, unknown>;
      if (typeof obj.text === "string") {
        chunks.push(obj.text);
      } else if (typeof obj.content === "string") {
        chunks.push(obj.content);
      } else {
        // Keep a compact JSON fallback for non-text parts (images, etc.).
        try {
          chunks.push(JSON.stringify(obj));
        } catch {
          // ignore
        }
      }
    }
  }
  return chunks.join("\n");
}

function extractText(node: ConversationMessageNode): string {
  const content = node.message?.content;
  if (!content) return "";
  if (Array.isArray(content.parts)) {
    return partsToText(content.parts);
  }
  return "";
}

/**
 * Walk from current_node up via parent links, then reverse → chronological active branch.
 * Only includes user / assistant messages with non-empty visible text by default.
 */
export function activeBranchTranscript(
  detail: ConversationDetail,
  options: { maxMessages?: number } = {},
): ActiveTranscript {
  const mapping = detail.mapping ?? {};
  const conversationId =
    detail.conversation_id ?? detail.id ?? "unknown";
  const maxMessages = options.maxMessages ?? 100;

  const chain: ConversationMessageNode[] = [];
  let cursor: string | null | undefined = detail.current_node;

  // Safety cap against malformed cycles.
  const seen = new Set<string>();
  while (cursor && mapping[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    const node = mapping[cursor];
    chain.push(node);
    cursor = node.parent ?? null;
  }

  chain.reverse();

  const messages: TranscriptMessage[] = [];
  for (const node of chain) {
    const role = node.message?.author?.role ?? "unknown";
    if (role !== "user" && role !== "assistant") {
      // Skip system / tool / etc. for MVP "page-visible dialogue".
      continue;
    }
    const text = extractText(node);
    if (!text.trim()) continue;
    messages.push({
      role,
      content: text,
      created_at: isoFromUnix(node.message?.create_time ?? null),
      message_id: node.message?.id ?? node.id ?? null,
    });
  }

  let truncated = false;
  let finalMessages = messages;
  if (messages.length > maxMessages) {
    truncated = true;
    const head = Math.max(1, Math.floor(maxMessages / 4));
    const tail = maxMessages - head;
    finalMessages = [
      ...messages.slice(0, head),
      {
        role: "system",
        content: `[truncated ${messages.length - maxMessages} messages in the middle; total visible user/assistant messages: ${messages.length}]`,
        created_at: null,
        message_id: null,
      },
      ...messages.slice(messages.length - tail),
    ];
  }

  return {
    conversation_id: conversationId,
    title: detail.title?.trim() || "(untitled)",
    updated_at: isoFromUnix(detail.update_time ?? null),
    created_at: isoFromUnix(detail.create_time ?? null),
    branch: "active",
    message_count: messages.length,
    truncated,
    messages: finalMessages,
  };
}

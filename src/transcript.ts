import type {
  ConversationDetail,
  ConversationMessageNode,
  ConversationTimestamp,
} from "./chatgpt-client.js";
import {
  inferConversationCompletionStatus,
  inferConversationExperience,
  type ConversationCompletionStatus,
  type ConversationExperience,
} from "./conversation-experience.js";
import {
  extractMessageContent,
  type ConversationAssetReference,
  type MessageRichContent,
} from "./rich-content.js";

export type TranscriptMessage = {
  role: string;
  content: string;
  content_type: string | null;
  created_at: string | null;
  message_id: string | null;
  rich_content?: MessageRichContent;
};

export type ActiveTranscript = {
  conversation_id: string;
  title: string;
  updated_at: string | null;
  created_at: string | null;
  branch: "active";
  experience: ConversationExperience;
  completion_status: ConversationCompletionStatus;
  async_status: string | null;
  message_count: number;
  truncated: boolean;
  messages: TranscriptMessage[];
};

function isoFromTimestamp(
  ts: ConversationTimestamp | undefined,
): string | null {
  if (typeof ts === "string") {
    const ms = Date.parse(ts);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (ts == null || !Number.isFinite(ts)) return null;
  // ChatGPT sometimes returns seconds, sometimes ms-ish; treat large values as ms.
  const ms = ts > 1e12 ? ts : ts * 1000;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

const INTERNAL_CONTENT_TYPES = new Set([
  "model_editable_context",
  "reasoning_recap",
  "thoughts",
  "user_editable_context",
]);

function isVisibleDialogueNode(node: ConversationMessageNode): boolean {
  const message = node.message;
  const role = message?.author?.role;
  if (!message || (role !== "user" && role !== "assistant")) return false;
  if (message.metadata?.is_visually_hidden_from_conversation === true) {
    return false;
  }
  const recipient =
    typeof message.recipient === "string" ? message.recipient.trim() : "";
  if (recipient && recipient !== "all") return false;
  const contentType = message.content?.content_type;
  return !contentType || !INTERNAL_CONTENT_TYPES.has(contentType);
}

function activeBranchNodes(
  detail: ConversationDetail,
): ConversationMessageNode[] {
  const mapping = detail.mapping ?? {};
  const chain: ConversationMessageNode[] = [];
  let cursor: string | null | undefined = detail.current_node;
  const seen = new Set<string>();
  while (cursor && mapping[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    const node = mapping[cursor];
    chain.push(node);
    cursor = node.parent ?? null;
  }
  chain.reverse();
  return chain;
}

/**
 * Walk from current_node up via parent links, then reverse → chronological active branch.
 * Includes visible user / assistant messages containing text or supported rich content.
 */
export function activeBranchTranscript(
  detail: ConversationDetail,
  options: { maxMessages?: number } = {},
): ActiveTranscript {
  const conversationId =
    detail.conversation_id ?? detail.id ?? "unknown";
  const maxMessages = options.maxMessages ?? 100;

  const messages: TranscriptMessage[] = [];
  for (const node of activeBranchNodes(detail)) {
    if (!isVisibleDialogueNode(node)) continue;
    const role = node.message?.author?.role ?? "unknown";
    const extracted = extractMessageContent(node, conversationId);
    if (!extracted.text.trim() && !extracted.richContent) continue;
    const message: TranscriptMessage = {
      role,
      content: extracted.text,
      content_type: node.message?.content?.content_type ?? null,
      created_at: isoFromTimestamp(node.message?.create_time ?? null),
      message_id: node.message?.id ?? node.id ?? null,
    };
    if (extracted.richContent) {
      message.rich_content = extracted.richContent;
    }
    messages.push(message);
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
        content_type: "text",
        created_at: null,
        message_id: null,
      },
      ...messages.slice(messages.length - tail),
    ];
  }

  return {
    conversation_id: conversationId,
    title: detail.title?.trim() || "(untitled)",
    updated_at: isoFromTimestamp(detail.update_time ?? null),
    created_at: isoFromTimestamp(detail.create_time ?? null),
    branch: "active",
    experience: inferConversationExperience(detail),
    completion_status: inferConversationCompletionStatus(detail),
    async_status: detail.async_status ?? null,
    message_count: messages.length,
    truncated,
    messages: finalMessages,
  };
}

export function findActiveBranchAsset(
  detail: ConversationDetail,
  assetId: string,
): ConversationAssetReference | null {
  if (!/^asset_[A-Za-z0-9_-]{32}$/.test(assetId)) return null;
  const conversationId =
    detail.conversation_id ?? detail.id ?? "unknown";
  for (const node of activeBranchNodes(detail)) {
    if (!isVisibleDialogueNode(node)) continue;
    const reference = extractMessageContent(
      node,
      conversationId,
    ).assetReferences.find((candidate) => candidate.asset.asset_id === assetId);
    if (reference) return reference;
  }
  return null;
}

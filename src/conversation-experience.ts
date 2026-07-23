import type {
  ConversationDetail,
  ConversationMessageNode,
} from "./chatgpt-client.js";

export type ConversationExperience = "chat" | "work" | "unknown";

export type ConversationCompletionStatus =
  | "completed"
  | "in_progress"
  | "failed"
  | "unknown";

export type ConversationExperienceSignals = {
  conversation_origin?: string | null;
  async_status?: string | null;
  is_automation_conversation?: boolean;
  default_model_slug?: string | null;
  workspace_id?: string | null;
  mapping?: Record<string, ConversationMessageNode>;
};

const WORK_ORIGINS = new Set(["tpp"]);
const WORK_METADATA_KEYS = new Set([
  "codex_collab_agent_tool_call",
  "codex_sub_agent_activity",
  "working_turn_id",
  "writing_blocks",
]);

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hasWorkMetadata(metadata: Record<string, unknown>): boolean {
  return Object.keys(metadata).some((key) => WORK_METADATA_KEYS.has(key));
}

function mappingHasWorkSignals(
  mapping: Record<string, ConversationMessageNode> | undefined,
): boolean {
  if (!mapping) return false;
  return Object.values(mapping).some((node) => {
    const metadata = node.message?.metadata;
    return metadata ? hasWorkMetadata(metadata) : false;
  });
}

/**
 * Classify the ChatGPT experience without confusing Work with an organization
 * workspace. The values are private Web fields, so unknown is intentional when
 * the upstream response does not carry a positive signal.
 */
export function inferConversationExperience(
  conversation: ConversationExperienceSignals,
): ConversationExperience {
  const origin = normalized(conversation.conversation_origin);
  if (WORK_ORIGINS.has(origin)) return "work";
  if (conversation.is_automation_conversation === true) return "work";

  const modelSlug = normalized(conversation.default_model_slug);
  if (/(?:^|[-_.])wm$/.test(modelSlug)) return "work";
  if (mappingHasWorkSignals(conversation.mapping)) return "work";

  if (Object.hasOwn(conversation, "conversation_origin")) return "chat";
  return "unknown";
}

function statusFromValue(
  value: string | null | undefined,
): ConversationCompletionStatus | null {
  const status = normalized(value).replace(/[\s-]+/g, "_");
  if (!status) return null;
  if (/(?:failed|error|cancelled|canceled)/.test(status)) return "failed";
  if (/(?:completed|complete|finished|succeeded|success)/.test(status)) {
    return "completed";
  }
  if (/(?:running|in_progress|pending|queued|started|streaming)/.test(status)) {
    return "in_progress";
  }
  return null;
}

export function inferConversationCompletionStatus(
  detail: ConversationDetail,
): ConversationCompletionStatus {
  const asyncStatus = statusFromValue(detail.async_status);
  if (asyncStatus) return asyncStatus;

  const currentMessage = detail.current_node
    ? detail.mapping?.[detail.current_node]?.message
    : null;
  if (!currentMessage) return "unknown";

  const completeFlag = currentMessage.metadata?.is_complete;
  if (completeFlag === true) return "completed";
  if (completeFlag === false) return "in_progress";

  const messageStatus = statusFromValue(currentMessage.status);
  if (messageStatus) return messageStatus;
  if (currentMessage.end_turn === true) return "completed";
  return "unknown";
}

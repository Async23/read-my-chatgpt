/**
 * Conversation Reader MCP — tool surface (live, read-only)
 *
 * Tools:
 *   list_conversations
 *   get_conversation
 *   search_conversations  (title-only)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ChatGPTApiError,
  ChatGPTAuthError,
  ChatGPTChallengeError,
  ChatGPTClient,
  ChatGPTTimeoutError,
  type ConversationListItem,
  type ConversationListResponse,
} from "./chatgpt-client.js";
import { ConfigError, type Config } from "./config.js";
import { activeBranchTranscript } from "./transcript.js";
import { PACKAGE_VERSION } from "./version.js";

function jsonResult(data: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

function errorResult(err: unknown) {
  if (err instanceof ConfigError) {
    return jsonResult({ error: err.code, message: err.message }, true);
  }
  if (err instanceof ChatGPTAuthError) {
    return jsonResult({ error: err.code, message: err.message }, true);
  }
  if (err instanceof ChatGPTChallengeError) {
    return jsonResult({ error: err.code, message: err.message }, true);
  }
  if (err instanceof ChatGPTTimeoutError) {
    return jsonResult({ error: err.code, message: err.message }, true);
  }
  if (err instanceof ChatGPTApiError) {
    return jsonResult(
      { error: err.code, message: err.message, status: err.status ?? null },
      true,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return jsonResult({ error: "internal_error", message }, true);
}

function normalizeItem(item: ConversationListItem) {
  return {
    id: item.id,
    title: item.title?.trim() || "(untitled)",
    create_time: item.create_time ?? null,
    update_time: item.update_time ?? null,
    is_archived: Boolean(item.is_archived),
  };
}

function hasMoreConversations(
  data: ConversationListResponse,
  requestedOffset: number,
  itemCount: number,
  requestedLimit: number,
): boolean {
  if (
    typeof data.total === "number" &&
    Number.isFinite(data.total) &&
    data.total >= 0
  ) {
    const responseOffset =
      typeof data.offset === "number" &&
      Number.isFinite(data.offset) &&
      data.offset >= 0
        ? data.offset
        : requestedOffset;
    return responseOffset + itemCount < data.total;
  }

  // Some Web API variants omit total; retain a conservative fallback.
  return itemCount >= requestedLimit;
}

type SearchHit = {
  conversation_id: string;
  title: string;
  update_time: number | null;
  is_archived: boolean;
};

type SearchScope = {
  isArchived: boolean;
  offset: number;
  done: boolean;
  hits: SearchHit[];
};

function sortableUpdateTime(hit: SearchHit): number {
  return typeof hit.update_time === "number" &&
    Number.isFinite(hit.update_time)
    ? hit.update_time
    : Number.NEGATIVE_INFINITY;
}

export function createReadMyChatGptMcpServer(
  config: Config,
  client: ChatGPTClient,
): McpServer {
  const server = new McpServer({
    name: "conversation-reader-mcp",
    version: PACKAGE_VERSION,
  });

  server.registerTool(
    "list_conversations",
    {
      description:
        "List your ChatGPT web conversations (metadata only: id, title, timestamps). Use when you need recent chats or do not know a conversation_id. Does not return message bodies.",
      inputSchema: {
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Pagination offset (default 0)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Page size (default 28, max 50)"),
        include_archived: z
          .boolean()
          .optional()
          .describe("If true, list archived conversations only; default false (non-archived)"),
      },
    },
    async ({ offset, limit, include_archived }) => {
      try {
        const pageLimit = Math.min(
          limit ?? config.defaultPageSize,
          config.maxPageSize,
        );
        const pageOffset = offset ?? 0;
        const data = await client.listConversations({
          offset: pageOffset,
          limit: pageLimit,
          order: "updated",
          isArchived: include_archived === true ? true : false,
        });
        const items = (data.items ?? []).map(normalizeItem);
        return jsonResult({
          items,
          offset: pageOffset,
          limit: pageLimit,
          count: items.length,
          has_more: hasMoreConversations(
            data,
            pageOffset,
            items.length,
            pageLimit,
          ),
          source: { kind: "live", host: config.baseUrl },
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_conversation",
    {
      description:
        "Fetch one ChatGPT conversation and return the active branch only (the current visible user/assistant turn chain). Use after list_conversations or search_conversations when you have a conversation_id.",
      inputSchema: {
        conversation_id: z
          .string()
          .min(1)
          .describe("Conversation id from list/search"),
        max_messages: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe(
            "Max visible user/assistant messages to return (default 100). Longer threads are truncated with head+tail kept.",
          ),
      },
    },
    async ({ conversation_id, max_messages }) => {
      try {
        const detail = await client.getConversation(conversation_id);
        const transcript = activeBranchTranscript(detail, {
          maxMessages: max_messages ?? config.defaultMaxMessages,
        });
        return jsonResult({
          ...transcript,
          source: { kind: "live", host: config.baseUrl },
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "search_conversations",
    {
      description:
        "Search your ChatGPT conversations by title only (MVP). Returns matching conversation ids and titles. For full dialogue content, call get_conversation next.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Case-insensitive substring matched against conversation titles"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max hits to return (default 10)"),
        include_archived: z
          .boolean()
          .optional()
          .describe("Also scan archived titles if true (default false)"),
      },
    },
    async ({ query, limit, include_archived }) => {
      try {
        const hitLimit = limit ?? 10;
        const needle = query.trim().toLowerCase();
        if (!needle) {
          return jsonResult(
            { error: "invalid_argument", message: "query must not be empty" },
            true,
          );
        }

        const pageSize = config.defaultPageSize;
        let scanned = 0;
        const scopes: SearchScope[] = [
          { isArchived: false, offset: 0, done: false, hits: [] },
        ];
        if (include_archived === true) {
          scopes.push({
            isArchived: true,
            offset: 0,
            done: false,
            hits: [],
          });
        }

        // Alternate pages between active and archived scopes. Each scope only
        // needs its first hitLimit matches; later matches cannot enter the
        // globally newest hitLimit results because the API is ordered by update.
        while (
          scanned < config.searchMaxScan &&
          scopes.some((scope) => !scope.done)
        ) {
          let madeRequest = false;

          for (const scope of scopes) {
            if (scope.done || scanned >= config.searchMaxScan) continue;
            madeRequest = true;

            const requestLimit = Math.min(
              pageSize,
              config.searchMaxScan - scanned,
            );
            const requestedOffset = scope.offset;
            const data = await client.listConversations({
              offset: requestedOffset,
              limit: requestLimit,
              order: "updated",
              isArchived: scope.isArchived,
            });
            const items = data.items ?? [];
            if (items.length === 0) {
              scope.done = true;
              continue;
            }

            for (const item of items) {
              if (scanned >= config.searchMaxScan) break;
              scanned += 1;
              const title = item.title?.trim() || "(untitled)";
              if (!title.toLowerCase().includes(needle)) continue;

              scope.hits.push({
                conversation_id: item.id,
                title,
                update_time: item.update_time ?? null,
                is_archived: item.is_archived ?? scope.isArchived,
              });
              if (scope.hits.length >= hitLimit) {
                scope.done = true;
                break;
              }
            }

            if (scope.done || scanned >= config.searchMaxScan) continue;
            if (
              !hasMoreConversations(
                data,
                requestedOffset,
                items.length,
                requestLimit,
              )
            ) {
              scope.done = true;
              continue;
            }

            const responseOffset =
              typeof data.offset === "number" &&
              Number.isFinite(data.offset) &&
              data.offset >= 0
                ? data.offset
                : requestedOffset;
            scope.offset = responseOffset + requestLimit;
          }

          if (!madeRequest) break;
        }

        const hits = scopes
          .flatMap((scope) => scope.hits)
          .sort((left, right) => {
            const leftTime = sortableUpdateTime(left);
            const rightTime = sortableUpdateTime(right);
            if (leftTime === rightTime) return 0;
            return rightTime > leftTime ? 1 : -1;
          })
          .slice(0, hitLimit);

        return jsonResult({
          query,
          hits,
          scanned,
          scan_cap: config.searchMaxScan,
          scope: "titles",
          source: { kind: "live", host: config.baseUrl },
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}

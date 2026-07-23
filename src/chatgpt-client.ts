import type {
  BinaryTransportResponse,
  ChatGPTTransport,
} from "./transport/chatgpt-transport.js";

export class ChatGPTAuthError extends Error {
  readonly code = "auth_expired";
  constructor(message: string) {
    super(message);
    this.name = "ChatGPTAuthError";
  }
}

export class ChatGPTChallengeError extends Error {
  readonly code = "cloudflare_challenge";
  constructor(message: string) {
    super(message);
    this.name = "ChatGPTChallengeError";
  }
}

export class ChatGPTApiError extends Error {
  readonly code = "chatgpt_api_error";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ChatGPTApiError";
  }
}

export class ChatGPTTimeoutError extends Error {
  readonly code = "upstream_timeout";
  constructor(message: string) {
    super(message);
    this.name = "ChatGPTTimeoutError";
  }
}

export class ChatGPTAssetTooLargeError extends Error {
  readonly code = "asset_too_large";
  constructor(readonly maxBytes: number) {
    super(`Asset exceeds the ${maxBytes} byte limit`);
    this.name = "ChatGPTAssetTooLargeError";
  }
}

export type ConversationTimestamp = number | string | null;

export type ConversationListItem = {
  id: string;
  title: string;
  create_time?: ConversationTimestamp;
  update_time?: ConversationTimestamp;
  is_archived?: boolean;
  conversation_origin?: string | null;
  async_status?: string | null;
  is_automation_conversation?: boolean;
  default_model_slug?: string | null;
  workspace_id?: string | null;
};

export type ConversationListResponse = {
  items: ConversationListItem[];
  total?: number;
  offset?: number;
  limit?: number;
  has_missing_conversations?: boolean;
};

export type ConversationMessageNode = {
  id: string;
  message?: {
    id?: string;
    author?: { role?: string; name?: string | null };
    create_time?: ConversationTimestamp;
    content?: {
      content_type?: string;
      parts?: unknown[];
      text?: unknown;
      content?: unknown;
      result?: unknown;
      thoughts?: unknown[];
    };
    metadata?: Record<string, unknown>;
    recipient?: string | null;
    status?: string | null;
    end_turn?: boolean | null;
  } | null;
  parent?: string | null;
  children?: string[];
};

export type ConversationDetail = {
  conversation_id?: string;
  id?: string;
  title?: string | null;
  create_time?: ConversationTimestamp;
  update_time?: ConversationTimestamp;
  current_node?: string | null;
  mapping?: Record<string, ConversationMessageNode>;
  is_archived?: boolean;
  conversation_origin?: string | null;
  async_status?: string | null;
  is_automation_conversation?: boolean;
  default_model_slug?: string | null;
  workspace_id?: string | null;
};

type FileDownloadDescriptor = {
  status?: unknown;
  download_url?: unknown;
  file_name?: unknown;
  mime_type?: unknown;
  content_type?: unknown;
};

export type DownloadedChatGPTFile = BinaryTransportResponse & {
  fileName: string | null;
  declaredMimeType: string | null;
};

export class ChatGPTClient {
  constructor(private readonly transport: ChatGPTTransport) {}

  async listConversations(params: {
    offset?: number;
    limit?: number;
    order?: "updated" | "created";
    isArchived?: boolean;
  } = {}): Promise<ConversationListResponse> {
    const q = new URLSearchParams();
    q.set("offset", String(params.offset ?? 0));
    q.set("limit", String(params.limit ?? 28));
    q.set("order", params.order ?? "updated");
    if (params.isArchived === true) {
      q.set("is_archived", "true");
    } else if (params.isArchived === false) {
      q.set("is_archived", "false");
    }

    return this.getJson<ConversationListResponse>(
      `/backend-api/conversations?${q.toString()}`,
    );
  }

  async getConversation(conversationId: string): Promise<ConversationDetail> {
    const id = encodeURIComponent(conversationId);
    return this.getJsonWithRetry<ConversationDetail>(
      `/backend-api/conversation/${id}`,
    );
  }

  async downloadConversationFile(
    conversationId: string,
    fileId: string,
    maxBytes: number,
  ): Promise<DownloadedChatGPTFile> {
    const path =
      `/backend-api/files/download/${encodeURIComponent(fileId)}` +
      `?conversation_id=${encodeURIComponent(conversationId)}&inline=false`;
    const descriptor = await this.requestJson<FileDownloadDescriptor>(
      () => this.transport.get(path),
      "/backend-api/files/download/:file_id",
      false,
    );
    if (
      descriptor.status === "error" ||
      typeof descriptor.download_url !== "string" ||
      !descriptor.download_url.trim()
    ) {
      throw new ChatGPTApiError(
        "ChatGPT did not provide an asset download URL",
      );
    }

    let response: BinaryTransportResponse;
    try {
      response = await this.transport.getBinary(
        descriptor.download_url,
        maxBytes,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const name = error instanceof Error ? error.name : "";
      if (/exceeds the \d+ byte limit/i.test(message)) {
        throw new ChatGPTAssetTooLargeError(maxBytes);
      }
      if (
        name === "AbortError" ||
        name === "TimeoutError" ||
        /\b(?:timed out|timeout)\b/i.test(message)
      ) {
        throw new ChatGPTTimeoutError(
          "Timed out downloading a ChatGPT conversation asset",
        );
      }
      throw new ChatGPTApiError(
        `Network error downloading a ChatGPT conversation asset (${name || "NetworkError"})`,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ChatGPTApiError(
        `ChatGPT asset download returned ${response.status}`,
        response.status,
      );
    }

    return {
      ...response,
      fileName:
        typeof descriptor.file_name === "string"
          ? descriptor.file_name
          : null,
      declaredMimeType:
        typeof descriptor.mime_type === "string"
          ? descriptor.mime_type
          : typeof descriptor.content_type === "string"
            ? descriptor.content_type
            : null,
    };
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.requestJson<T>(() => this.transport.get(path), path);
  }

  private async getJsonWithRetry<T>(
    path: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.getJson<T>(path);
      } catch (error) {
        if (error instanceof ChatGPTTimeoutError && attempt === 0) {
          continue;
        }
        throw error;
      }
    }
    throw new ChatGPTTimeoutError(
      `ChatGPT API timed out for ${path}`,
    );
  }

  private async requestJson<T>(
    request: () => ReturnType<ChatGPTTransport["get"]>,
    path: string,
    includeBodySnippet = true,
  ): Promise<T> {
    let response;
    try {
      response = await request();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "";
      if (
        name === "AbortError" ||
        name === "TimeoutError" ||
        /\b(?:timed out|timeout)\b/i.test(msg)
      ) {
        throw new ChatGPTTimeoutError(
          `Timed out calling ChatGPT API for ${path}: ${msg}`,
        );
      }
      throw new ChatGPTApiError(`Network error calling ChatGPT API: ${msg}`);
    }

    const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
    const lowerBody = response.body.toLowerCase();
    const isCloudflareChallenge =
      response.headers["cf-mitigated"]?.toLowerCase() === "challenge" ||
      (contentType.includes("text/html") &&
        (lowerBody.includes("just a moment") ||
          lowerBody.includes("cf-chl") ||
          lowerBody.includes("challenge-platform")));

    if (isCloudflareChallenge) {
      throw new ChatGPTChallengeError(
        "Cloudflare challenged the browser session before ChatGPT could validate the access token. Restart the Obscura session or use a supported browser session.",
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new ChatGPTAuthError(
        `ChatGPT API returned ${response.status}. Access token is missing, expired, or not allowed. Refresh READ_MY_CHATGPT_ACCESS_TOKEN and restart the MCP server.`,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      const snippet = includeBodySnippet ? response.body.slice(0, 300) : "";
      throw new ChatGPTApiError(
        `ChatGPT API ${response.status} for ${path}${snippet ? `: ${snippet}` : ""}`,
        response.status,
      );
    }

    try {
      return JSON.parse(response.body) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ChatGPTApiError(
        `ChatGPT API returned invalid JSON for ${path}: ${msg}`,
        response.status,
      );
    }
  }
}

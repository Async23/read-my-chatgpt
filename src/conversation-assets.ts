import {
  ChatGPTAssetTooLargeError,
  type ChatGPTClient,
  type DownloadedChatGPTFile,
} from "./chatgpt-client.js";
import type { RichAsset } from "./rich-content.js";
import { findActiveBranchAsset } from "./transcript.js";

export type ConversationAssetErrorCode =
  | "asset_not_found"
  | "asset_mime_error"
  | "asset_too_large";

export class ConversationAssetError extends Error {
  constructor(
    readonly code: ConversationAssetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConversationAssetError";
  }
}

export type ConversationAssetSource = Pick<
  ChatGPTClient,
  "getConversation" | "downloadConversationFile"
>;

export type DownloadedConversationAsset = RichAsset & {
  name: string | null;
  mime_type: string;
  size_bytes: number;
  body: Uint8Array;
};

function normalizeMimeType(value: string | null | undefined): string | null {
  if (!value) return null;
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(
    mimeType,
  )
    ? mimeType
    : null;
}

function safeFileName(value: string | null): string | null {
  if (!value) return null;
  const name = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[\\/]/)
    .at(-1)
    ?.trim()
    .slice(0, 300);
  return name || null;
}

export async function readConversationAsset(
  source: ConversationAssetSource,
  conversationId: string,
  assetId: string,
  maxBytes: number,
): Promise<DownloadedConversationAsset> {
  const detail = await source.getConversation(conversationId);
  const reference = findActiveBranchAsset(detail, assetId);
  if (!reference) {
    throw new ConversationAssetError(
      "asset_not_found",
      "Asset was not found on the active visible branch of this conversation",
    );
  }
  if (
    reference.asset.size_bytes !== null &&
    reference.asset.size_bytes > maxBytes
  ) {
    throw new ConversationAssetError(
      "asset_too_large",
      `Asset exceeds the ${maxBytes} byte limit`,
    );
  }

  let downloaded: DownloadedChatGPTFile;
  try {
    downloaded = await source.downloadConversationFile(
      conversationId,
      reference.fileId,
      maxBytes,
    );
  } catch (error) {
    if (error instanceof ChatGPTAssetTooLargeError) {
      throw new ConversationAssetError(
        "asset_too_large",
        `Asset exceeds the ${maxBytes} byte limit`,
      );
    }
    throw error;
  }
  if (downloaded.body.byteLength > maxBytes) {
    throw new ConversationAssetError(
      "asset_too_large",
      `Asset exceeds the ${maxBytes} byte limit`,
    );
  }

  const rawHeaderMime = downloaded.headers["content-type"] ?? null;
  const headerMime = normalizeMimeType(rawHeaderMime);
  if (rawHeaderMime?.trim() && !headerMime) {
    throw new ConversationAssetError(
      "asset_mime_error",
      "Asset response contained an invalid MIME type",
    );
  }
  const declaredMime = normalizeMimeType(downloaded.declaredMimeType);
  const metadataMime = normalizeMimeType(reference.asset.mime_type);
  const genericMime = headerMime === "application/octet-stream";
  const mimeType =
    (!genericMime ? headerMime : null) ??
    declaredMime ??
    metadataMime ??
    headerMime ??
    "application/octet-stream";

  if (
    mimeType === "text/html" ||
    mimeType === "application/xhtml+xml" ||
    (reference.asset.kind === "image" && !mimeType.startsWith("image/"))
  ) {
    throw new ConversationAssetError(
      "asset_mime_error",
      reference.asset.kind === "image"
        ? "Image asset did not return an image MIME type"
        : "Asset returned an unsafe MIME type",
    );
  }

  return {
    ...reference.asset,
    name:
      safeFileName(reference.asset.name) ??
      safeFileName(downloaded.fileName),
    mime_type: mimeType,
    size_bytes: downloaded.body.byteLength,
    body: downloaded.body,
  };
}

import { createHash } from "node:crypto";
import type { ConversationMessageNode } from "./chatgpt-client.js";

export type RichLink = {
  kind: "web" | "image" | "sandbox";
  url: string;
  title: string | null;
};

export type RichCitation = {
  url: string;
  title: string | null;
  attribution: string | null;
  reference_type: string;
};

export type RichDiagram = {
  format: "mermaid";
  source: string;
};

export type RichAsset = {
  asset_id: string;
  kind: "image" | "file";
  name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
};

export type MessageRichContent = {
  links?: RichLink[];
  citations?: RichCitation[];
  diagrams?: RichDiagram[];
  assets?: RichAsset[];
};

export type ConversationAssetReference = {
  asset: RichAsset;
  fileId: string;
};

export type ExtractedMessageContent = {
  text: string;
  richContent: MessageRichContent | null;
  assetReferences: ConversationAssetReference[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

function compactName(value: unknown): string | null {
  const name = nonEmptyString(value);
  if (!name) return null;
  return name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 300) || null;
}

function assetIdFor(conversationId: string, fileId: string): string {
  const digest = createHash("sha256")
    .update(conversationId)
    .update("\0")
    .update(fileId)
    .digest("base64url")
    .slice(0, 32);
  return `asset_${digest}`;
}

function fileIdFromPointer(value: unknown): string | null {
  let pointer = nonEmptyString(value);
  if (!pointer) return null;
  for (const prefix of ["sediment://", "file-service://"]) {
    if (pointer.startsWith(prefix)) {
      pointer = pointer.slice(prefix.length);
      break;
    }
  }
  return /^[A-Za-z0-9._-]{1,512}$/.test(pointer) ? pointer : null;
}

function partsToText(parts: unknown[] | undefined): string {
  if (!parts?.length) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      chunks.push(part);
      continue;
    }
    if (!isRecord(part)) continue;
    if (typeof part.text === "string") {
      chunks.push(part.text);
    } else if (typeof part.content === "string") {
      chunks.push(part.content);
    }
  }
  return chunks.join("\n");
}

function extractText(node: ConversationMessageNode): string {
  const content = node.message?.content;
  if (!content) return "";
  if (Array.isArray(content.parts)) {
    const text = partsToText(content.parts);
    if (text) return text;
  }
  for (const value of [content.text, content.content, content.result]) {
    if (typeof value === "string") return value;
  }
  return "";
}

function validLinkUrl(value: string): RichLink["kind"] | null {
  if (/^https?:\/\//i.test(value)) return "web";
  if (/^sandbox:\/+/i.test(value)) return "sandbox";
  return null;
}

function extractLinks(text: string): RichLink[] {
  const links: RichLink[] = [];
  const seen = new Set<string>();
  const add = (
    urlValue: string,
    titleValue: string | null,
    image: boolean,
  ) => {
    const url = urlValue.replace(/^<|>$/g, "").trim();
    const baseKind = validLinkUrl(url);
    if (!baseKind || seen.has(url)) return;
    seen.add(url);
    links.push({
      kind: image ? "image" : baseKind,
      url,
      title: titleValue?.trim() || null,
    });
  };

  const markdown = /(!?)\[([^\]\n]*)\]\(\s*(<?[^\s)>]+>?)?(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of text.matchAll(markdown)) {
    if (!match[3]) continue;
    add(match[3], match[2] ?? null, match[1] === "!");
  }

  const bare = /https?:\/\/[^\s<>{}\[\]"']+/gi;
  for (const match of text.matchAll(bare)) {
    let url = match[0];
    while (/[),.;!?]$/.test(url)) url = url.slice(0, -1);
    add(url, null, false);
  }
  return links;
}

function extractMermaid(text: string): RichDiagram[] {
  const diagrams: RichDiagram[] = [];
  const blocks = /(?:^|\n)(`{3,}|~{3,})mermaid[^\n]*\r?\n([\s\S]*?)\r?\n\1(?=\n|$)/gi;
  for (const match of text.matchAll(blocks)) {
    const source = match[2]?.trim();
    if (source) diagrams.push({ format: "mermaid", source });
  }
  return diagrams;
}

function httpUrl(value: unknown): string | null {
  const text = nonEmptyString(value);
  if (!text || !/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:"
      ? text
      : null;
  } catch {
    return null;
  }
}

function extractCitations(metadata: Record<string, unknown> | undefined): RichCitation[] {
  if (!metadata) return [];
  const citations: RichCitation[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, referenceType: string) => {
    if (!isRecord(value)) return;
    const nested = isRecord(value.metadata) ? value.metadata : null;
    const source = nested ?? value;
    const url = httpUrl(source.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    citations.push({
      url,
      title: nonEmptyString(source.title),
      attribution: nonEmptyString(source.attribution),
      reference_type: referenceType,
    });
  };

  if (Array.isArray(metadata.citations)) {
    for (const citation of metadata.citations) add(citation, "citation");
  }

  const citeMetadata = isRecord(metadata._cite_metadata)
    ? metadata._cite_metadata
    : null;
  if (citeMetadata && Array.isArray(citeMetadata.metadata_list)) {
    for (const citation of citeMetadata.metadata_list) {
      add(citation, "citation_metadata");
    }
  }

  if (Array.isArray(metadata.content_references)) {
    for (const reference of metadata.content_references) {
      if (!isRecord(reference)) continue;
      const referenceType = nonEmptyString(reference.type) ?? "content_reference";
      const collections = [
        reference.items,
        reference.sources,
        reference.fallback_items,
      ];
      let found = false;
      for (const collection of collections) {
        if (!Array.isArray(collection)) continue;
        for (const source of collection) {
          const before = citations.length;
          add(source, referenceType);
          found ||= citations.length > before;
          if (isRecord(source) && Array.isArray(source.supporting_websites)) {
            for (const supporting of source.supporting_websites) {
              const supportingBefore = citations.length;
              add(supporting, referenceType);
              found ||= citations.length > supportingBefore;
            }
          }
        }
      }
      if (!found) add(reference, referenceType);
      if (!found && Array.isArray(reference.safe_urls)) {
        for (const safeUrl of reference.safe_urls) {
          const url = httpUrl(safeUrl);
          if (!url || seen.has(url)) continue;
          seen.add(url);
          citations.push({
            url,
            title: null,
            attribution: null,
            reference_type: referenceType,
          });
        }
      }
    }
  }
  return citations;
}

type MutableAsset = {
  fileId: string;
  kind: "image" | "file";
  name: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
};

function extractAssets(
  node: ConversationMessageNode,
  conversationId: string,
): ConversationAssetReference[] {
  const byFileId = new Map<string, MutableAsset>();
  const add = (candidate: MutableAsset) => {
    const previous = byFileId.get(candidate.fileId);
    if (!previous) {
      byFileId.set(candidate.fileId, candidate);
      return;
    }
    previous.kind =
      previous.kind === "image" || candidate.kind === "image"
        ? "image"
        : "file";
    previous.name ??= candidate.name;
    previous.mimeType ??= candidate.mimeType;
    previous.sizeBytes ??= candidate.sizeBytes;
    previous.width ??= candidate.width;
    previous.height ??= candidate.height;
  };

  const parts = node.message?.content?.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (!isRecord(part) || part.content_type !== "image_asset_pointer") {
        continue;
      }
      const fileId = fileIdFromPointer(part.asset_pointer);
      if (!fileId) continue;
      const partMetadata = isRecord(part.metadata) ? part.metadata : null;
      add({
        fileId,
        kind: "image",
        name:
          compactName(part.name) ??
          compactName(partMetadata?.name) ??
          compactName(partMetadata?.title),
        mimeType: nonEmptyString(part.mime_type),
        sizeBytes: finiteNonNegative(part.size_bytes),
        width: finiteNonNegative(part.width),
        height: finiteNonNegative(part.height),
      });
    }
  }

  const attachments = node.message?.metadata?.attachments;
  if (Array.isArray(attachments)) {
    for (const attachment of attachments) {
      if (!isRecord(attachment)) continue;
      const fileId =
        fileIdFromPointer(attachment.id) ??
        fileIdFromPointer(attachment.file_id) ??
        fileIdFromPointer(attachment.asset_pointer);
      if (!fileId) continue;
      const mimeType = nonEmptyString(attachment.mime_type);
      add({
        fileId,
        kind: mimeType?.toLowerCase().startsWith("image/")
          ? "image"
          : "file",
        name: compactName(attachment.name),
        mimeType,
        sizeBytes:
          finiteNonNegative(attachment.size) ??
          finiteNonNegative(attachment.size_bytes),
        width: finiteNonNegative(attachment.width),
        height: finiteNonNegative(attachment.height),
      });
    }
  }

  return [...byFileId.values()].map((value) => ({
    fileId: value.fileId,
    asset: {
      asset_id: assetIdFor(conversationId, value.fileId),
      kind: value.kind,
      name: value.name,
      mime_type: value.mimeType,
      size_bytes: value.sizeBytes,
      width: value.width,
      height: value.height,
    },
  }));
}

export function extractMessageContent(
  node: ConversationMessageNode,
  conversationId: string,
): ExtractedMessageContent {
  const text = extractText(node);
  const links = extractLinks(text);
  const citations = extractCitations(node.message?.metadata);
  const diagrams = extractMermaid(text);
  const assetReferences = extractAssets(node, conversationId);
  const richContent: MessageRichContent = {};
  if (links.length) richContent.links = links;
  if (citations.length) richContent.citations = citations;
  if (diagrams.length) richContent.diagrams = diagrams;
  if (assetReferences.length) {
    richContent.assets = assetReferences.map((reference) => reference.asset);
  }

  return {
    text,
    richContent: Object.keys(richContent).length ? richContent : null,
    assetReferences,
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import type {
  ConversationDetail,
  DownloadedChatGPTFile,
} from "../src/chatgpt-client.js";
import {
  ConversationAssetError,
  readConversationAsset,
  type ConversationAssetSource,
} from "../src/conversation-assets.js";
import { activeBranchTranscript } from "../src/transcript.js";

function fixture(sizeBytes = 4): ConversationDetail {
  return {
    conversation_id: "asset-conversation",
    current_node: "message",
    mapping: {
      message: {
        id: "message",
        parent: null,
        children: [],
        message: {
          id: "message",
          author: { role: "assistant" },
          content: {
            content_type: "multimodal_text",
            parts: [
              {
                content_type: "image_asset_pointer",
                asset_pointer: "sediment://file_image",
                mime_type: "image/png",
                size_bytes: sizeBytes,
              },
            ],
          },
        },
      },
    },
  };
}

class FakeAssetSource implements ConversationAssetSource {
  downloads = 0;

  constructor(
    private readonly detail: ConversationDetail,
    private readonly downloaded: DownloadedChatGPTFile = {
      status: 200,
      headers: { "content-type": "image/png" },
      body: Uint8Array.from([137, 80, 78, 71]),
      fileName: "image.png",
      declaredMimeType: "image/png",
    },
  ) {}

  async getConversation(): Promise<ConversationDetail> {
    return this.detail;
  }

  async downloadConversationFile(): Promise<DownloadedChatGPTFile> {
    this.downloads += 1;
    return this.downloaded;
  }
}

test("downloads an asset that was disclosed on the active branch", async () => {
  const detail = fixture();
  const assetId =
    activeBranchTranscript(detail).messages[0]?.rich_content?.assets?.[0]
      ?.asset_id;
  assert.ok(assetId);
  const source = new FakeAssetSource(detail);

  const asset = await readConversationAsset(source, "asset-conversation", assetId, 10);

  assert.equal(source.downloads, 1);
  assert.equal(asset.kind, "image");
  assert.equal(asset.mime_type, "image/png");
  assert.equal(asset.size_bytes, 4);
  assert.deepEqual([...asset.body], [137, 80, 78, 71]);
});

test("rejects fabricated asset ids before requesting file bytes", async () => {
  const source = new FakeAssetSource(fixture());

  await assert.rejects(
    () =>
      readConversationAsset(
        source,
        "asset-conversation",
        `asset_${"a".repeat(32)}`,
        10,
      ),
    (error) =>
      error instanceof ConversationAssetError &&
      error.code === "asset_not_found",
  );
  assert.equal(source.downloads, 0);
});

test("rejects known oversized assets before downloading", async () => {
  const detail = fixture(11);
  const assetId =
    activeBranchTranscript(detail).messages[0]?.rich_content?.assets?.[0]
      ?.asset_id;
  assert.ok(assetId);
  const source = new FakeAssetSource(detail);

  await assert.rejects(
    () => readConversationAsset(source, "asset-conversation", assetId, 10),
    (error) =>
      error instanceof ConversationAssetError &&
      error.code === "asset_too_large",
  );
  assert.equal(source.downloads, 0);
});

test("rejects image responses with a non-image MIME type", async () => {
  const detail = fixture();
  const assetId =
    activeBranchTranscript(detail).messages[0]?.rich_content?.assets?.[0]
      ?.asset_id;
  assert.ok(assetId);
  const source = new FakeAssetSource(detail, {
    status: 200,
    headers: { "content-type": "text/html" },
    body: new TextEncoder().encode("<html></html>"),
    fileName: "login.html",
    declaredMimeType: "text/html",
  });

  await assert.rejects(
    () => readConversationAsset(source, "asset-conversation", assetId, 100),
    (error) =>
      error instanceof ConversationAssetError &&
      error.code === "asset_mime_error",
  );
});

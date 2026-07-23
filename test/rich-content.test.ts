import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationDetail } from "../src/chatgpt-client.js";
import { extractMessageContent } from "../src/rich-content.js";
import {
  activeBranchTranscript,
  findActiveBranchAsset,
} from "../src/transcript.js";

test("extracts links, citations, Mermaid, images, and attachments", () => {
  const node = {
    id: "assistant",
    parent: null,
    children: [],
    message: {
      id: "assistant",
      author: { role: "assistant" },
      content: {
        content_type: "multimodal_text",
        parts: [
          "Read [the docs](https://example.com/docs) and https://example.net.\n\n" +
            "```mermaid\ngraph TD\n  A --> B\n```\n\n" +
            "[Download](sandbox:/mnt/data/report.csv)",
          {
            content_type: "image_asset_pointer",
            asset_pointer: "sediment://file_image_1",
            width: 1024,
            height: 768,
            size_bytes: 1234,
          },
        ],
      },
      metadata: {
        attachments: [
          {
            id: "file_image_1",
            name: "diagram.png",
            mime_type: "image/png",
            size: 1234,
          },
          {
            id: "file_report_1",
            name: "report.pdf",
            mime_type: "application/pdf",
            size: 4567,
          },
        ],
        citations: [
          {
            metadata: {
              title: "Legacy source",
              url: "https://source.example/legacy",
            },
          },
        ],
        content_references: [
          {
            type: "grouped_webpages",
            items: [
              {
                title: "Primary source",
                url: "https://source.example/primary",
                supporting_websites: [
                  {
                    attribution: "Supporting source",
                    url: "https://source.example/supporting",
                  },
                ],
              },
            ],
          },
          {
            type: "sources_footnote",
            safe_urls: ["https://source.example/footnote"],
          },
        ],
      },
    },
  };

  const extracted = extractMessageContent(node, "conversation-rich");
  assert.match(extracted.text, /graph TD/);
  assert.deepEqual(extracted.richContent?.links, [
    {
      kind: "web",
      url: "https://example.com/docs",
      title: "the docs",
    },
    { kind: "sandbox", url: "sandbox:/mnt/data/report.csv", title: "Download" },
    { kind: "web", url: "https://example.net", title: null },
  ]);
  assert.deepEqual(extracted.richContent?.diagrams, [
    { format: "mermaid", source: "graph TD\n  A --> B" },
  ]);
  assert.deepEqual(
    extracted.richContent?.citations?.map((citation) => citation.url),
    [
      "https://source.example/legacy",
      "https://source.example/primary",
      "https://source.example/supporting",
      "https://source.example/footnote",
    ],
  );
  assert.equal(extracted.richContent?.assets?.length, 2);
  assert.deepEqual(
    extracted.richContent?.assets?.map((asset) => asset.kind),
    ["image", "file"],
  );
  assert.match(
    extracted.richContent?.assets?.[0]?.asset_id ?? "",
    /^asset_[A-Za-z0-9_-]{32}$/,
  );
  assert.doesNotMatch(
    JSON.stringify(extracted.richContent),
    /file_image_1|file_report_1|sediment:/,
  );
});

test("keeps image-only messages and only resolves active visible assets", () => {
  const detail: ConversationDetail = {
    conversation_id: "conversation-assets",
    current_node: "active",
    mapping: {
      root: { id: "root", parent: null, children: ["active", "old"] },
      active: {
        id: "active",
        parent: "root",
        children: [],
        message: {
          id: "active",
          author: { role: "assistant" },
          content: {
            content_type: "multimodal_text",
            parts: [
              {
                content_type: "image_asset_pointer",
                asset_pointer: "sediment://file_active",
                mime_type: "image/png",
              },
            ],
          },
        },
      },
      old: {
        id: "old",
        parent: "root",
        children: [],
        message: {
          id: "old",
          author: { role: "assistant" },
          content: {
            content_type: "multimodal_text",
            parts: [
              {
                content_type: "image_asset_pointer",
                asset_pointer: "sediment://file_hidden_branch",
              },
            ],
          },
        },
      },
    },
  };

  const transcript = activeBranchTranscript(detail);
  assert.equal(transcript.messages.length, 1);
  assert.equal(transcript.messages[0]?.content, "");
  const asset = transcript.messages[0]?.rich_content?.assets?.[0];
  assert.ok(asset);
  assert.equal(asset.kind, "image");
  assert.equal(findActiveBranchAsset(detail, asset.asset_id)?.fileId, "file_active");

  const oldAsset = extractMessageContent(
    detail.mapping?.old ?? { id: "missing" },
    "conversation-assets",
  ).richContent?.assets?.[0];
  assert.ok(oldAsset);
  assert.equal(findActiveBranchAsset(detail, oldAsset.asset_id), null);
});

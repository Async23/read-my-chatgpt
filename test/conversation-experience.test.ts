import assert from "node:assert/strict";
import test from "node:test";
import {
  inferConversationCompletionStatus,
  inferConversationExperience,
} from "../src/conversation-experience.js";

test("recognizes positive Work signals without confusing organization workspaces", () => {
  assert.equal(
    inferConversationExperience({ conversation_origin: "tpp" }),
    "work",
  );
  assert.equal(
    inferConversationExperience({ default_model_slug: "gpt-example-wm" }),
    "work",
  );
  assert.equal(
    inferConversationExperience({
      mapping: {
        work: {
          id: "work",
          message: {
            metadata: { working_turn_id: "synthetic-turn" },
          },
        },
      },
    }),
    "work",
  );
  assert.equal(
    inferConversationExperience({ conversation_origin: null }),
    "chat",
  );
  assert.equal(
    inferConversationExperience({ workspace_id: "team-workspace" }),
    "unknown",
  );
  assert.equal(
    inferConversationExperience({}),
    "unknown",
  );
});

test("derives completed and running states from the current Work turn", () => {
  assert.equal(
    inferConversationCompletionStatus({
      current_node: "done",
      mapping: {
        done: {
          id: "done",
          message: {
            status: "finished_successfully",
            end_turn: true,
          },
        },
      },
    }),
    "completed",
  );
  assert.equal(
    inferConversationCompletionStatus({ async_status: "in_progress" }),
    "in_progress",
  );
  assert.equal(
    inferConversationCompletionStatus({ async_status: "failed" }),
    "failed",
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CLI_VERSION } from "../src/cli.js";

test("CLI version matches package.json", async () => {
  const packageJson = JSON.parse(
    await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    ),
  ) as { version?: unknown };

  assert.equal(CLI_VERSION, packageJson.version);
});

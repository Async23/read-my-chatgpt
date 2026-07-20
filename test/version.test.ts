import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CLI_VERSION } from "../src/cli.js";
import {
  LAUNCHD_LABEL,
  MCP_SERVER_NAME,
  SERVICE_NAME,
} from "../src/install-paths.js";

test("published identity and CLI version match package.json", async () => {
  const packageJson = JSON.parse(
    await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    ),
  ) as {
    name?: unknown;
    version?: unknown;
    bin?: Record<string, unknown>;
    repository?: { url?: unknown };
  };

  assert.equal(CLI_VERSION, packageJson.version);
  assert.equal(packageJson.name, SERVICE_NAME);
  assert.equal(packageJson.bin?.[SERVICE_NAME], "dist/index.js");
  assert.equal(MCP_SERVER_NAME, SERVICE_NAME);
  assert.equal(
    LAUNCHD_LABEL,
    `io.github.async23.${SERVICE_NAME}`,
  );
  assert.equal(
    packageJson.repository?.url,
    `git+https://github.com/Async23/${SERVICE_NAME}.git`,
  );
});

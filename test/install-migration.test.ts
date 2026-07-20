import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateLegacyInstallation } from "../src/install-migration.js";
import {
  installPaths,
  legacyInstallPaths,
} from "../src/install-paths.js";
import {
  readServiceEnvironment,
  writeServiceEnvironment,
} from "../src/service-config.js";

test("migrates the previous service identity without losing local data", async (t) => {
  const home = await mkdtemp(
    join(tmpdir(), "read-my-chatgpt-migration-"),
  );
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = {
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
  };
  const current = installPaths({ env, homeDirectory: home });
  const legacy = legacyInstallPaths({ env, homeDirectory: home });
  const legacyBinary = join(
    legacy.dataDirectory,
    "obscura",
    "v0.1.10",
    "test",
    "obscura",
  );
  await mkdir(legacy.obscuraStorageDirectory, { recursive: true });
  await mkdir(join(legacy.dataDirectory, "obscura", "v0.1.10", "test"), {
    recursive: true,
  });
  await writeFile(legacyBinary, "binary");
  await writeFile(
    join(legacy.obscuraStorageDirectory, "profile-marker"),
    "profile",
  );
  await writeServiceEnvironment(legacy.serviceConfigPath, {
    READ_MY_CHATGPT_ACCESS_TOKEN: "secret",
    READ_MY_CHATGPT_OBSCURA_BIN: legacyBinary,
    READ_MY_CHATGPT_OBSCURA_STORAGE_DIR:
      legacy.obscuraStorageDirectory,
  });
  await mkdir(join(home, "Library", "Logs"), { recursive: true });
  await writeFile(legacy.stdoutLogPath, "old log");

  let removedLabel: string | undefined;
  const result = await migrateLegacyInstallation({
    platform: "darwin",
    env,
    homeDirectory: home,
    serviceUninstaller: async ({ paths }) => {
      removedLabel = paths.launchdLabel;
    },
  });

  assert.equal(result.detected, true);
  assert.equal(
    removedLabel,
    "io.github.async23.conversation-reader-mcp",
  );
  assert.deepEqual(
    await readServiceEnvironment(current.serviceConfigPath),
    {
      READ_MY_CHATGPT_ACCESS_TOKEN: "secret",
      READ_MY_CHATGPT_OBSCURA_BIN: join(
        current.dataDirectory,
        "obscura",
        "v0.1.10",
        "test",
        "obscura",
      ),
      READ_MY_CHATGPT_OBSCURA_STORAGE_DIR:
        current.obscuraStorageDirectory,
    },
  );
  assert.equal(
    await readFile(
      join(current.obscuraStorageDirectory, "profile-marker"),
      "utf8",
    ),
    "profile",
  );
  assert.equal(await readFile(current.stdoutLogPath, "utf8"), "old log");
  await assert.rejects(
    () => readFile(legacy.serviceConfigPath, "utf8"),
    { code: "ENOENT" },
  );
});

test("does nothing when no previous installation exists", async (t) => {
  const home = await mkdtemp(
    join(tmpdir(), "read-my-chatgpt-no-migration-"),
  );
  t.after(() => rm(home, { recursive: true, force: true }));
  let uninstallCalled = false;

  const result = await migrateLegacyInstallation({
    platform: "darwin",
    env: {},
    homeDirectory: home,
    serviceUninstaller: async () => {
      uninstallCalled = true;
    },
  });

  assert.deepEqual(result, {
    detected: false,
    migratedPaths: [],
    retainedPaths: [],
  });
  assert.equal(uninstallCalled, false);
});

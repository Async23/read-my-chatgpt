import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { once } from "node:events";
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

test("waits for the legacy launchd process to flush data before moving it", async (t) => {
  const home = await mkdtemp(
    join(tmpdir(), "read-my-chatgpt-shutdown-race-"),
  );
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = {
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
  };
  const current = installPaths({ env, homeDirectory: home });
  const legacy = legacyInstallPaths({ env, homeDirectory: home });
  const legacyCookies = join(
    legacy.obscuraStorageDirectory,
    "cookies.json",
  );
  const currentCookies = join(
    current.obscuraStorageDirectory,
    "cookies.json",
  );
  await mkdir(legacy.obscuraStorageDirectory, { recursive: true });
  await writeFile(legacyCookies, "before-shutdown");
  await writeServiceEnvironment(legacy.serviceConfigPath, {
    READ_MY_CHATGPT_ACCESS_TOKEN: "secret",
    READ_MY_CHATGPT_OBSCURA_STORAGE_DIR:
      legacy.obscuraStorageDirectory,
  });
  await mkdir(join(current.configDirectory, "existing-backup"), {
    recursive: true,
  });
  await mkdir(join(home, "Library", "LaunchAgents"), {
    recursive: true,
  });
  await writeFile(legacy.launchAgentPath, "legacy launch agent");

  const writer = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import { mkdir, writeFile } from "node:fs/promises";
        process.on("SIGTERM", () => {
          setTimeout(async () => {
            await mkdir(${JSON.stringify(legacy.obscuraStorageDirectory)}, { recursive: true });
            await writeFile(${JSON.stringify(legacyCookies)}, "after-shutdown");
            process.exit(0);
          }, 75);
        });
        process.stdout.write("ready\\n");
        setInterval(() => {}, 1_000);
      `,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  t.after(() => {
    if (writer.exitCode === null && writer.signalCode === null) {
      writer.kill("SIGKILL");
    }
  });
  await once(writer.stdout!, "data");

  const binDirectory = join(home, "bin");
  const fakeLaunchctl = join(binDirectory, "launchctl");
  await mkdir(binDirectory, { recursive: true });
  await writeFile(
    fakeLaunchctl,
    `#!/usr/bin/env node
const pid = Number(process.env.READ_MY_CHATGPT_TEST_SERVICE_PID);
if (process.argv[2] === "print") {
  process.stdout.write(\`pid = \${pid}\\nstate = running\\n\`);
} else if (process.argv[2] === "bootout") {
  process.kill(pid, "SIGTERM");
}
`,
  );
  await chmod(fakeLaunchctl, 0o700);

  const originalPath = process.env.PATH;
  const originalPid = process.env.READ_MY_CHATGPT_TEST_SERVICE_PID;
  process.env.PATH = `${binDirectory}:${originalPath ?? ""}`;
  process.env.READ_MY_CHATGPT_TEST_SERVICE_PID = String(writer.pid);
  const writerExit = once(writer, "exit");
  t.after(() => {
    process.env.PATH = originalPath;
    if (originalPid === undefined) {
      delete process.env.READ_MY_CHATGPT_TEST_SERVICE_PID;
    } else {
      process.env.READ_MY_CHATGPT_TEST_SERVICE_PID = originalPid;
    }
  });

  const result = await migrateLegacyInstallation({
    platform: "darwin",
    env,
    homeDirectory: home,
  });
  await writerExit;

  assert.equal(await readFile(currentCookies, "utf8"), "after-shutdown");
  await assert.rejects(() => readFile(legacyCookies, "utf8"), {
    code: "ENOENT",
  });
  await assert.rejects(() => stat(legacy.configDirectory), {
    code: "ENOENT",
  });
  assert.equal(
    result.retainedPaths.includes(legacy.configDirectory),
    false,
  );
});

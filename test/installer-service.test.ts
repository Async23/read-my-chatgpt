import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installPaths } from "../src/install-paths.js";
import {
  managedObscuraBinaryPath,
  obscuraAssetFor,
  sha256,
  validateObscuraBinary,
} from "../src/obscura-installer.js";
import {
  readServiceEnvironment,
  writeServiceEnvironment,
} from "../src/service-config.js";
import {
  installService,
  renderLaunchAgent,
  renderSystemdUnit,
} from "../src/service-manager.js";

test("maps supported Obscura assets and rejects unsupported platforms", () => {
  const asset = obscuraAssetFor("darwin", "arm64");
  assert.equal(asset.filename, "obscura-aarch64-macos.tar.gz");
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => obscuraAssetFor("win32", "arm64"), /not available/);
  assert.equal(
    sha256(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("uses an XDG-scoped managed Obscura path", () => {
  assert.equal(
    managedObscuraBinaryPath({
      env: { XDG_DATA_HOME: "/tmp/example-data" },
      homeDirectory: "/home/example",
      platform: "linux",
      arch: "x64",
    }),
    "/tmp/example-data/read-my-chatgpt/obscura/v0.1.10/linux-x64/obscura",
  );
});

test("validates the required Obscura CLI features", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "read-my-chatgpt-bin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, "obscura");
  await writeFile(
    binary,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "obscura 0.1.10"
elif [ "$1" = "serve" ] && [ "$2" = "--help" ]; then
  echo "--host --port --storage-dir --quiet --stealth"
else
  exit 2
fi
`,
  );
  await chmod(binary, 0o700);

  await validateObscuraBinary(binary, true);
});

test("writes service secrets privately and validates their keys", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "read-my-chatgpt-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "nested", "service.json");

  await writeServiceEnvironment(path, {
    READ_MY_CHATGPT_ACCESS_TOKEN: "private-token",
    READ_MY_CHATGPT_MCP_PORT: "47831",
  });

  assert.deepEqual(await readServiceEnvironment(path), {
    READ_MY_CHATGPT_ACCESS_TOKEN: "private-token",
    READ_MY_CHATGPT_MCP_PORT: "47831",
  });
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  await writeFile(path, '{"PATH":"/tmp"}\n');
  await assert.rejects(
    () => readServiceEnvironment(path),
    /Unsupported service config key/,
  );
});

test("renders dynamic launchd and systemd definitions safely", () => {
  const paths = installPaths({
    env: {
      XDG_CONFIG_HOME: "/home/a&b/.config",
      XDG_DATA_HOME: "/home/a&b/.data",
    },
    homeDirectory: "/home/a&b",
  });
  const options = {
    platform: "darwin" as const,
    paths,
    nodePath: '/opt/node "stable"/bin/node',
    entrypointPath: "/opt/read-my-chatgpt/dist/index.js",
  };
  const plist = renderLaunchAgent(options);
  assert.match(plist, /io\.github\.async23\.read-my-chatgpt/);
  assert.match(plist, /\/home\/a&amp;b/);
  assert.doesNotMatch(plist, /\/Users\/alfheim/);

  const unit = renderSystemdUnit({ ...options, platform: "linux" });
  assert.match(unit, /Read My ChatGPT MCP singleton/);
  assert.match(unit, /node \\"stable\\"/);
  assert.doesNotMatch(unit, /\/Users\/alfheim/);
});

test("waits for an existing launchd process before bootstrapping its replacement", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "read-my-chatgpt-reinstall-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = installPaths({
    env: {
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local", "share"),
    },
    homeDirectory: home,
  });
  const writer = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        process.on("SIGTERM", () => {
          setTimeout(() => process.exit(0), 100);
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
const command = process.argv[2];
if (command === "print") {
  process.stdout.write(\`pid = \${pid}\\nstate = running\\n\`);
} else if (command === "bootout") {
  process.kill(pid, "SIGTERM");
} else if (command === "bootstrap") {
  try {
    process.kill(pid, 0);
    process.stderr.write("old service is still exiting\\n");
    process.exit(5);
  } catch {}
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

  await installService({
    platform: "darwin",
    paths,
    nodePath: process.execPath,
    entrypointPath: "/tmp/read-my-chatgpt.js",
  });
  await writerExit;
});

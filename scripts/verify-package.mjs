import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(
  join(tmpdir(), "conversation-reader-mcp-package-"),
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    ...options,
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
  );
  return result;
}

try {
  const packDirectory = join(temporaryRoot, "pack");
  const installDirectory = join(temporaryRoot, "install");
  mkdirSync(packDirectory, { recursive: true });
  const packResult = run("npm", [
    "pack",
    "--pack-destination",
    packDirectory,
    "--silent",
  ]);
  const tarballName = packResult.stdout.trim().split(/\r?\n/).at(-1);
  assert.ok(tarballName, "npm pack did not report a tarball");
  const tarballPath = join(packDirectory, tarballName);
  const listing = run("tar", ["-tzf", tarballPath]).stdout;
  assert.match(listing, /package\/README\.md/);
  assert.match(listing, /package\/LICENSE/);
  assert.match(listing, /package\/THIRD_PARTY_NOTICES\.md/);
  assert.match(listing, /package\/licenses\/OBSCURA-APACHE-2\.0\.txt/);
  assert.match(listing, /package\/dist\/obscura-installer\.js/);
  assert.doesNotMatch(listing, /package\/src\//);
  assert.doesNotMatch(listing, /package\/\.env$/m);
  assert.notEqual(
    statSync(join(root, "dist", "index.js")).mode & 0o111,
    0,
    "dist/index.js must remain executable after a clean build",
  );

  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--silent",
      "--prefix",
      installDirectory,
      tarballPath,
    ],
    { cwd: temporaryRoot },
  );

  const installedPackageDirectory = join(
    installDirectory,
    "node_modules",
    "conversation-reader-mcp",
  );
  const installedPackage = JSON.parse(
    readFileSync(join(installedPackageDirectory, "package.json"), "utf8"),
  );
  assert.equal(installedPackage.name, "conversation-reader-mcp");
  const binTarget =
    installedPackage.bin?.["conversation-reader-mcp"];
  assert.equal(binTarget, "dist/index.js");
  assert.match(
    readFileSync(join(installedPackageDirectory, ".env.example"), "utf8"),
    /READ_MY_CHATGPT_ACCESS_TOKEN=/,
  );

  const executable = join(
    installDirectory,
    "node_modules",
    ".bin",
    "conversation-reader-mcp",
  );
  const help = run(executable, ["--help"], { cwd: temporaryRoot });
  assert.match(help.stdout, /conversation-reader-mcp setup/);
  const version = run(executable, ["--version"], {
    cwd: temporaryRoot,
  });
  assert.equal(version.stdout.trim(), installedPackage.version);

  const smoke = spawnSync(executable, [], {
    cwd: temporaryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      READ_MY_CHATGPT_ACCESS_TOKEN: "test-token",
      READ_MY_CHATGPT_TRANSPORT: "direct",
    },
    input: "",
    timeout: 5_000,
  });
  assert.ifError(smoke.error);
  assert.equal(smoke.status, 0, smoke.stderr || smoke.stdout);
  assert.match(
    smoke.stderr,
    /\[conversation-reader-mcp\] ready on stdio/,
  );

  console.error("verify-package.mjs: ok");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

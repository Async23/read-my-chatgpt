import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
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

async function runLifecycle(executable, temporaryRoot) {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    console.error(
      `verify-package.mjs: skipping service lifecycle on ${process.platform}`,
    );
    return;
  }

  const lifecycleRoot = join(temporaryRoot, "lifecycle");
  const home = join(lifecycleRoot, "home");
  const fakeBin = join(lifecycleRoot, "bin");
  const serviceLog = join(lifecycleRoot, "service-manager.log");
  const healthScript = join(lifecycleRoot, "health-server.mjs");
  mkdirSync(home, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  const managerName =
    process.platform === "darwin" ? "launchctl" : "systemctl";
  const managerPath = join(fakeBin, managerName);
  writeFileSync(
    managerPath,
    `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_SERVICE_LOG"
if [ "$1" = "print" ]; then
  printf 'state = running\n'
fi
if [ "$1" = "--user" ] && [ "$2" = "is-active" ]; then
  printf 'active\n'
fi
exit 0
`,
  );
  chmodSync(managerPath, 0o700);

  const obscuraPath = join(fakeBin, "obscura");
  writeFileSync(
    obscuraPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'obscura 0.1.10\n'
elif [ "$1" = "serve" ] && [ "$2" = "--help" ]; then
  printf '%s\n' '--host --port --storage-dir --quiet --stealth'
else
  exit 2
fi
`,
  );
  chmodSync(obscuraPath, 0o700);

  writeFileSync(
    healthScript,
    `import { createServer } from "node:http";

const server = createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      status: "ok",
      server: "conversation-reader-mcp",
    }));
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") process.exit(2);
  process.stdout.write(String(address.port) + "\\n");
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
`,
  );

  const health = spawn(process.execPath, [healthScript], {
    cwd: lifecycleRoot,
    stdio: ["ignore", "pipe", "inherit"],
  });

  try {
    const port = await firstLine(health);
    assert.match(port, /^\d+$/);

    const cleanEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("READ_MY_CHATGPT_"),
      ),
    );
    const xdgConfigHome = join(home, ".config");
    const xdgDataHome = join(home, ".local", "share");
    const env = {
      ...cleanEnvironment,
      HOME: home,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
      PATH: [
        fakeBin,
        dirname(process.execPath),
        process.env.PATH,
      ]
        .filter(Boolean)
        .join(delimiter),
      FAKE_SERVICE_LOG: serviceLog,
      READ_MY_CHATGPT_ACCESS_TOKEN: "Bearer package-test-access-token",
      READ_MY_CHATGPT_MCP_BEARER_TOKEN: "package-test-mcp-token",
      READ_MY_CHATGPT_OBSCURA_BIN: obscuraPath,
    };

    const invalidPort = spawnSync(
      executable,
      ["setup", "--yes", "--port", "0"],
      {
        cwd: lifecycleRoot,
        encoding: "utf8",
        env,
        timeout: 30_000,
      },
    );
    assert.ifError(invalidPort.error);
    assert.equal(invalidPort.status, 1);
    assert.match(invalidPort.stderr, /--port must be an integer/);

    const setup = run(
      executable,
      [
        "setup",
        "--yes",
        "--no-configure",
        "--port",
        port,
      ],
      { cwd: lifecycleRoot, env },
    );
    assert.match(setup.stdout, /conversation-reader-mcp is running/);

    const serviceConfigPath = join(
      xdgConfigHome,
      "conversation-reader-mcp",
      "service.json",
    );
    const serviceConfig = JSON.parse(
      readFileSync(serviceConfigPath, "utf8"),
    );
    assert.equal(
      serviceConfig.READ_MY_CHATGPT_ACCESS_TOKEN,
      "package-test-access-token",
    );
    assert.equal(
      serviceConfig.READ_MY_CHATGPT_MCP_BEARER_TOKEN,
      "package-test-mcp-token",
    );
    assert.equal(serviceConfig.READ_MY_CHATGPT_MCP_PORT, port);
    assert.equal(statSync(serviceConfigPath).mode & 0o777, 0o600);

    const serviceDefinition =
      process.platform === "darwin"
        ? join(
            home,
            "Library",
            "LaunchAgents",
            "io.github.async23.conversation-reader-mcp.plist",
          )
        : join(
            xdgConfigHome,
            "systemd",
            "user",
            "conversation-reader-mcp.service",
          );
    assert.equal(existsSync(serviceDefinition), true);

    const configure = run(executable, ["configure", "cursor"], {
      cwd: lifecycleRoot,
      env,
    });
    assert.match(configure.stdout, /cursor/);
    const cursorConfigPath = join(home, ".cursor", "mcp.json");
    assert.match(
      readFileSync(cursorConfigPath, "utf8"),
      /conversation-reader/,
    );

    const doctor = run(executable, ["doctor", "--json"], {
      cwd: lifecycleRoot,
      env,
    });
    const diagnosis = JSON.parse(doctor.stdout);
    assert.equal(diagnosis.ok, true);
    assert.ok(
      diagnosis.checks.every((check) => check.ok),
      JSON.stringify(diagnosis.checks),
    );

    const uninstall = run(
      executable,
      ["uninstall", "--purge", "--yes"],
      { cwd: lifecycleRoot, env },
    );
    assert.match(uninstall.stdout, /Local configuration and data removed/);
    assert.equal(existsSync(serviceConfigPath), false);
    assert.equal(existsSync(serviceDefinition), false);
    assert.doesNotMatch(
      readFileSync(cursorConfigPath, "utf8"),
      /conversation-reader/,
    );

    const managerCommands = readFileSync(serviceLog, "utf8");
    assert.match(
      managerCommands,
      process.platform === "darwin" ? /bootstrap/ : /enable --now/,
    );
    assert.match(
      managerCommands,
      process.platform === "darwin" ? /bootout/ : /disable --now/,
    );
  } finally {
    await stopChild(health);
  }
}

function firstLine(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("health server did not report a port"));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onData = (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      cleanup();
      resolve(buffer.slice(0, newline).trim());
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code) => {
      cleanup();
      reject(
        new Error(`health server exited before ready with code ${code}`),
      );
    };
    child.stdout?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
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
  assert.match(listing, /package\/CHANGELOG\.md/);
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

  await runLifecycle(executable, temporaryRoot);

  console.error("verify-package.mjs: ok");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

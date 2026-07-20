import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  LAUNCHD_LABEL,
  SERVICE_NAME,
  type InstallPaths,
} from "./install-paths.js";

export type ServiceInstallOptions = {
  platform: NodeJS.Platform;
  paths: InstallPaths;
  nodePath: string;
  entrypointPath: string;
  uid?: number;
};

export type ServiceStatus = {
  manager: "launchd" | "systemd";
  installed: boolean;
  running: boolean;
  detail?: string;
};

export async function installService(
  options: ServiceInstallOptions,
): Promise<void> {
  if (options.platform === "darwin") {
    await installLaunchAgent(options);
    return;
  }
  if (options.platform === "linux") {
    await installSystemdUserService(options);
    return;
  }
  throw new Error(
    `Automatic background service setup is not supported on ${options.platform}.`,
  );
}

export async function uninstallService(
  options: Pick<ServiceInstallOptions, "platform" | "paths" | "uid">,
): Promise<void> {
  if (options.platform === "darwin") {
    const domain = `gui/${options.uid ?? process.getuid?.()}`;
    await runAllowFailure("launchctl", [
      "bootout",
      `${domain}/${LAUNCHD_LABEL}`,
    ]);
    await rm(options.paths.launchAgentPath, { force: true });
    return;
  }
  if (options.platform === "linux") {
    await runAllowFailure("systemctl", [
      "--user",
      "disable",
      "--now",
      `${SERVICE_NAME}.service`,
    ]);
    await rm(options.paths.systemdUnitPath, { force: true });
    await runAllowFailure("systemctl", ["--user", "daemon-reload"]);
    return;
  }
  throw new Error(
    `Automatic background service removal is not supported on ${options.platform}.`,
  );
}

export async function getServiceStatus(
  options: Pick<ServiceInstallOptions, "platform" | "paths" | "uid">,
): Promise<ServiceStatus> {
  if (options.platform === "darwin") {
    const installed = await fileExists(options.paths.launchAgentPath);
    const domain = `gui/${options.uid ?? process.getuid?.()}`;
    const result = await runAllowFailure("launchctl", [
      "print",
      `${domain}/${LAUNCHD_LABEL}`,
    ]);
    return {
      manager: "launchd",
      installed,
      running: result.code === 0 && /\bstate = running\b/.test(result.stdout),
      detail: result.code === 0 ? undefined : result.stderr.trim(),
    };
  }
  if (options.platform === "linux") {
    const installed = await fileExists(options.paths.systemdUnitPath);
    const result = await runAllowFailure("systemctl", [
      "--user",
      "is-active",
      `${SERVICE_NAME}.service`,
    ]);
    return {
      manager: "systemd",
      installed,
      running: result.code === 0 && result.stdout.trim() === "active",
      detail: result.code === 0 ? undefined : result.stderr.trim(),
    };
  }
  throw new Error(`Service status is not supported on ${options.platform}.`);
}

export function renderLaunchAgent(options: ServiceInstallOptions): string {
  const args = [
    options.nodePath,
    options.entrypointPath,
    "serve",
    "--config",
    options.paths.serviceConfigPath,
  ];
  const argumentXml = args
    .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argumentXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(options.paths.configDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>Umask</key>
  <integer>63</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(options.paths.stdoutLogPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(options.paths.stderrLogPath)}</string>
</dict>
</plist>
`;
}

export function renderSystemdUnit(options: ServiceInstallOptions): string {
  const command = [
    options.nodePath,
    options.entrypointPath,
    "serve",
    "--config",
    options.paths.serviceConfigPath,
  ]
    .map(systemdQuote)
    .join(" ");

  return `[Unit]
Description=Conversation Reader MCP singleton
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${command}
WorkingDirectory=${systemdQuote(options.paths.configDirectory)}
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
`;
}

async function installLaunchAgent(
  options: ServiceInstallOptions,
): Promise<void> {
  const domain = `gui/${options.uid ?? process.getuid?.()}`;
  await mkdir(dirname(options.paths.launchAgentPath), {
    recursive: true,
  });
  await mkdir(dirname(options.paths.stdoutLogPath), {
    recursive: true,
  });
  await mkdir(dirname(options.paths.stderrLogPath), {
    recursive: true,
  });
  await atomicWrite(
    options.paths.launchAgentPath,
    renderLaunchAgent(options),
    0o644,
  );
  await runAllowFailure("launchctl", [
    "bootout",
    `${domain}/${LAUNCHD_LABEL}`,
  ]);
  await run("launchctl", [
    "bootstrap",
    domain,
    options.paths.launchAgentPath,
  ]);
  await run("launchctl", [
    "kickstart",
    "-k",
    `${domain}/${LAUNCHD_LABEL}`,
  ]);
}

async function installSystemdUserService(
  options: ServiceInstallOptions,
): Promise<void> {
  await mkdir(dirname(options.paths.systemdUnitPath), {
    recursive: true,
  });
  await atomicWrite(
    options.paths.systemdUnitPath,
    renderSystemdUnit(options),
    0o644,
  );
  await run("systemctl", ["--user", "daemon-reload"]);
  await run("systemctl", [
    "--user",
    "enable",
    "--now",
    `${SERVICE_NAME}.service`,
  ]);
}

async function atomicWrite(
  path: string,
  contents: string,
  mode: number,
): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents, { mode });
  await rename(temporaryPath, path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function run(
  command: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await runAllowFailure(command, args);
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ` +
        `${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result;
}

async function runAllowFailure(
  command: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function systemdQuote(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")}"`;
}

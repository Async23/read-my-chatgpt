import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { SERVICE_NAME } from "./install-paths.js";

export const OBSCURA_VERSION = "0.1.10";
const OBSCURA_RELEASE_BASE =
  `https://github.com/h4ckf0r0day/obscura/releases/download/v${OBSCURA_VERSION}`;

export type ObscuraAsset = {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  filename: string;
  sha256: string;
  size: number;
};

export const OBSCURA_ASSETS: readonly ObscuraAsset[] = [
  {
    platform: "darwin",
    arch: "arm64",
    filename: "obscura-aarch64-macos.tar.gz",
    sha256: "a4a868cedf2fb95f2b3af2dc9dacf235eef08398f070387b9a02e65faf1f93e3",
    size: 45_878_984,
  },
  {
    platform: "darwin",
    arch: "x64",
    filename: "obscura-x86_64-macos.tar.gz",
    sha256: "cfd74f777be7dccebe0ed1fc4b264f8c4dfb0e52cf929d88acde85365c4e2961",
    size: 47_924_334,
  },
  {
    platform: "linux",
    arch: "arm64",
    filename: "obscura-aarch64-linux.tar.gz",
    sha256: "a50c154970934af3cf9fd2bec6c8a53ff76f25b0c4d9e78c286ce4bc3bca0adf",
    size: 52_391_280,
  },
  {
    platform: "linux",
    arch: "x64",
    filename: "obscura-x86_64-linux.tar.gz",
    sha256: "7efd9d53546b69ed6cc84a47d5c08ee7a7041ee87ab95e7310fda708608a5093",
    size: 50_582_528,
  },
];

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type EnsureObscuraOptions = {
  explicitBinary?: string;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
};

export function obscuraAssetFor(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): ObscuraAsset {
  const asset = OBSCURA_ASSETS.find(
    (candidate) =>
      candidate.platform === platform && candidate.arch === arch,
  );
  if (asset) return asset;

  throw new Error(
    `Obscura auto-install is not available for ${platform}/${arch}. ` +
      "Install Obscura v0.1.10+ manually and set READ_MY_CHATGPT_OBSCURA_BIN.",
  );
}

export function managedObscuraBinaryPath(
  options: Pick<
    EnsureObscuraOptions,
    "env" | "homeDirectory" | "platform" | "arch"
  > = {},
): string {
  const env = options.env ?? process.env;
  const home = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const dataHome =
    env.XDG_DATA_HOME?.trim() || join(home, ".local", "share");
  return join(
    dataHome,
    SERVICE_NAME,
    "obscura",
    `v${OBSCURA_VERSION}`,
    `${platform}-${arch}`,
    "obscura",
  );
}

export async function ensureObscuraBinary(
  options: EnsureObscuraOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const log = options.log ?? (() => {});

  if (options.explicitBinary?.trim()) {
    const configured = options.explicitBinary.trim();
    const explicit = configured.includes("/")
      ? configured
      : await findExecutableOnPath(configured, env);
    if (!explicit) {
      throw new Error(
        `Configured Obscura executable was not found on PATH: ${configured}`,
      );
    }
    await validateObscuraBinary(explicit);
    return explicit;
  }

  const pathBinary = await findExecutableOnPath("obscura", env);
  if (pathBinary) {
    try {
      await validateObscuraBinary(pathBinary);
      return pathBinary;
    } catch (error) {
      log(
        `Ignoring incompatible Obscura from PATH: ${errorMessage(error)}`,
      );
    }
  }

  assertSupportedLinuxRuntime(platform);
  const asset = obscuraAssetFor(platform, arch);
  const target = managedObscuraBinaryPath({
    env,
    homeDirectory: options.homeDirectory,
    platform,
    arch,
  });

  if (await isUsableManagedBinary(target)) return target;

  await installManagedObscura({
    asset,
    target,
    fetchImpl: options.fetchImpl ?? fetch,
    log,
  });
  await validateObscuraBinary(target, true);
  return target;
}

export async function validateObscuraBinary(
  binary: string,
  requireExactVersion = false,
): Promise<void> {
  await access(binary, fsConstants.X_OK);
  const version = await runCommand(binary, ["--version"], 10_000);
  const match = version.stdout
    .trim()
    .match(/^obscura\s+(\d+)\.(\d+)\.(\d+)(?:\s|$)/);
  if (!match) {
    throw new Error(
      `Could not parse Obscura version from ${JSON.stringify(version.stdout.trim())}`,
    );
  }

  const actual = match.slice(1).map(Number);
  const minimum = OBSCURA_VERSION.split(".").map(Number);
  const comparison = compareVersion(actual, minimum);
  if (comparison < 0 || (requireExactVersion && comparison !== 0)) {
    throw new Error(
      `Obscura ${OBSCURA_VERSION}${requireExactVersion ? "" : "+"} is required; ` +
        `found ${actual.join(".")}`,
    );
  }

  const help = await runCommand(binary, ["serve", "--help"], 10_000);
  const helpText = `${help.stdout}\n${help.stderr}`;
  for (const flag of ["--host", "--port", "--storage-dir", "--quiet", "--stealth"]) {
    if (!helpText.includes(flag)) {
      throw new Error(`Obscura build is missing required ${flag} support`);
    }
  }
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function installManagedObscura(options: {
  asset: ObscuraAsset;
  target: string;
  fetchImpl: typeof fetch;
  log: (message: string) => void;
}): Promise<void> {
  const { asset, target, fetchImpl, log } = options;
  const targetDirectory = dirname(target);
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  const lockPath = `${target}.install.lock`;
  const lock = await acquireInstallLock(lockPath, target);
  if (!lock) return;

  let temporaryDirectory: string | undefined;
  try {
    if (await isUsableManagedBinary(target)) return;

    temporaryDirectory = await mkdtemp(
      join(targetDirectory, ".install-"),
    );
    const archivePath = join(temporaryDirectory, asset.filename);
    const url = `${OBSCURA_RELEASE_BASE}/${asset.filename}`;
    log(
      `Downloading Obscura v${OBSCURA_VERSION} for ${asset.platform}/${asset.arch} ` +
        `(${Math.ceil(asset.size / 1024 / 1024)} MiB)...`,
    );
    const response = await fetchImpl(url, {
      headers: { "user-agent": `${SERVICE_NAME}-installer` },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(
        `Obscura download failed: HTTP ${response.status} ${response.statusText}`,
      );
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > asset.size) {
      throw new Error(
        `Obscura download is larger than expected: ${declaredSize} bytes`,
      );
    }
    const archive = new Uint8Array(await response.arrayBuffer());
    if (archive.byteLength !== asset.size) {
      throw new Error(
        `Obscura download size mismatch: expected ${asset.size}, got ${archive.byteLength}`,
      );
    }
    const actualHash = sha256(archive);
    if (actualHash !== asset.sha256) {
      throw new Error(
        `Obscura checksum mismatch: expected ${asset.sha256}, got ${actualHash}`,
      );
    }
    await writeFile(archivePath, archive, { mode: 0o600 });
    await assertSafeTarArchive(archivePath);
    await runCommand(
      tarBinary(),
      ["-xzf", archivePath, "-C", temporaryDirectory, "obscura"],
      60_000,
    );
    const extracted = join(temporaryDirectory, "obscura");
    await chmod(extracted, 0o755);

    await rm(target, { force: true });
    await rename(extracted, target);
    log(`Installed Obscura v${OBSCURA_VERSION} at ${target}`);
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

async function acquireInstallLock(
  lockPath: string,
  target: string,
): Promise<Awaited<ReturnType<typeof open>> | undefined> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      return await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      if (await isUsableManagedBinary(target)) return undefined;

      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > 10 * 60_000) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if (!isNodeError(statError, "ENOENT")) throw statError;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Timed out waiting for another Obscura installation");
}

async function assertSafeTarArchive(archivePath: string): Promise<void> {
  const listing = await runCommand(
    tarBinary(),
    ["-tzf", archivePath],
    30_000,
  );
  const entries = listing.stdout
    .split(/\r?\n/)
    .map((entry) => entry.replace(/^\.\//, ""))
    .filter(Boolean);
  const allowed = new Set(["obscura", "obscura-worker"]);
  if (
    entries.length === 0 ||
    !entries.includes("obscura") ||
    entries.some((entry) => !allowed.has(entry))
  ) {
    throw new Error(
      `Unexpected Obscura archive contents: ${entries.join(", ") || "(empty)"}`,
    );
  }
}

async function findExecutableOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined;
}

async function isUsableManagedBinary(path: string): Promise<boolean> {
  try {
    await validateObscuraBinary(path, true);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out running ${command}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed ` +
              `(code=${code ?? "null"}, signal=${signal ?? "none"}): ` +
              `${stderr.trim() || stdout.trim()}`,
          ),
        );
      }
    });
  });
}

function assertSupportedLinuxRuntime(platform: NodeJS.Platform): void {
  if (platform !== "linux") return;
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  const version = report?.header?.glibcVersionRuntime;
  if (!version) {
    throw new Error(
      "The official Obscura Linux binary requires glibc 2.35+; " +
        "musl/Alpine is not supported. Install a compatible Obscura manually " +
        "and set READ_MY_CHATGPT_OBSCURA_BIN.",
    );
  }
  const actual = version.split(".").map(Number);
  if (compareVersion(actual, [2, 35]) < 0) {
    throw new Error(
      `The official Obscura Linux binary requires glibc 2.35+; found ${version}.`,
    );
  }
}

function compareVersion(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function tarBinary(): string {
  return process.platform === "darwin" ? "/usr/bin/tar" : "tar";
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

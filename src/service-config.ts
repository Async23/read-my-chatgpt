import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

export type ServiceEnvironment = Record<string, string>;

export async function readServiceEnvironment(
  path: string,
): Promise<ServiceEnvironment> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Service config must be a JSON object: ${path}`);
  }

  const environment: ServiceEnvironment = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^READ_MY_CHATGPT_[A-Z0-9_]+$/.test(key)) {
      throw new Error(`Unsupported service config key: ${key}`);
    }
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) {
      throw new Error(`Service config value for ${key} must be one line`);
    }
    environment[key] = value;
  }
  return environment;
}

export async function writeServiceEnvironment(
  path: string,
  environment: ServiceEnvironment,
): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(environment, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rename(temporaryPath, path);
}

export function applyServiceEnvironment(
  environment: ServiceEnvironment,
): void {
  for (const [key, value] of Object.entries(environment)) {
    process.env[key] = value;
  }
}

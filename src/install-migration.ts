import {
  mkdir,
  rename,
  stat,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  installPaths,
  legacyInstallPaths,
  type InstallPaths,
} from "./install-paths.js";
import {
  readServiceEnvironment,
  writeServiceEnvironment,
} from "./service-config.js";
import { uninstallService } from "./service-manager.js";

export type InstallMigrationResult = {
  detected: boolean;
  migratedPaths: string[];
  retainedPaths: string[];
};

export async function migrateLegacyInstallation(options: {
  platform: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  uid?: number;
  serviceUninstaller?: typeof uninstallService;
}): Promise<InstallMigrationResult> {
  const pathOptions = {
    env: options.env,
    homeDirectory: options.homeDirectory,
  };
  const current = installPaths(pathOptions);
  const legacy = legacyInstallPaths(pathOptions);
  const artifacts = [
    legacy.configDirectory,
    legacy.dataDirectory,
    legacy.launchAgentPath,
    legacy.systemdUnitPath,
    legacy.stdoutLogPath,
    legacy.stderrLogPath,
  ];
  if (!(await anyPathExists(artifacts))) {
    return {
      detected: false,
      migratedPaths: [],
      retainedPaths: [],
    };
  }

  await (options.serviceUninstaller ?? uninstallService)({
    platform: options.platform,
    paths: legacy,
    uid: options.uid,
  });

  const migratedPaths: string[] = [];
  const retainedPaths: string[] = [];
  const configDirectoryMoved = await movePath(
    legacy.configDirectory,
    current.configDirectory,
    migratedPaths,
    retainedPaths,
  );
  const dataDirectoryMoved = await movePath(
    legacy.dataDirectory,
    current.dataDirectory,
    migratedPaths,
    retainedPaths,
  );
  await movePath(
    legacy.stdoutLogPath,
    current.stdoutLogPath,
    migratedPaths,
    retainedPaths,
  );
  await movePath(
    legacy.stderrLogPath,
    current.stderrLogPath,
    migratedPaths,
    retainedPaths,
  );

  let serviceConfigMoved = false;
  if (
    !(await pathExists(current.serviceConfigPath)) &&
    (await pathExists(legacy.serviceConfigPath))
  ) {
    serviceConfigMoved = await movePath(
      legacy.serviceConfigPath,
      current.serviceConfigPath,
      migratedPaths,
      retainedPaths,
    );
  }
  await rebaseServicePaths(current, legacy, {
    configMoved: configDirectoryMoved || serviceConfigMoved,
    dataMoved: dataDirectoryMoved,
  });

  return {
    detected: true,
    migratedPaths,
    retainedPaths,
  };
}

async function rebaseServicePaths(
  current: InstallPaths,
  legacy: InstallPaths,
  moved: {
    configMoved: boolean;
    dataMoved: boolean;
  },
): Promise<void> {
  if (!(await pathExists(current.serviceConfigPath))) return;

  const environment = await readServiceEnvironment(
    current.serviceConfigPath,
  );
  let changed = false;
  for (const [key, value] of Object.entries(environment)) {
    let rebased = value;
    if (moved.configMoved) {
      rebased = rebasePath(
        rebased,
        legacy.configDirectory,
        current.configDirectory,
      );
    }
    if (moved.dataMoved) {
      rebased = rebasePath(
        rebased,
        legacy.dataDirectory,
        current.dataDirectory,
      );
    }
    if (rebased !== value) {
      environment[key] = rebased;
      changed = true;
    }
  }
  if (changed) {
    await writeServiceEnvironment(
      current.serviceConfigPath,
      environment,
    );
  }
}

function rebasePath(
  value: string,
  legacyRoot: string,
  currentRoot: string,
): string {
  if (value === legacyRoot) return currentRoot;
  const prefix = `${legacyRoot}/`;
  return value.startsWith(prefix)
    ? `${currentRoot}/${value.slice(prefix.length)}`
    : value;
}

async function movePath(
  source: string,
  destination: string,
  migratedPaths: string[],
  retainedPaths: string[],
): Promise<boolean> {
  if (!(await pathExists(source))) return false;
  if (await pathExists(destination)) {
    retainedPaths.push(source);
    return false;
  }
  await mkdir(dirname(destination), { recursive: true });
  await rename(source, destination);
  migratedPaths.push(destination);
  return true;
}

async function anyPathExists(paths: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    if (await pathExists(path)) return true;
  }
  return false;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
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

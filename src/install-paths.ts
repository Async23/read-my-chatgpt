import { homedir } from "node:os";
import { join } from "node:path";

export const SERVICE_NAME = "conversation-reader-mcp";
export const MCP_SERVER_NAME = "conversation-reader";
export const LAUNCHD_LABEL = "io.github.async23.conversation-reader-mcp";

export type InstallPaths = {
  homeDirectory: string;
  configDirectory: string;
  dataDirectory: string;
  serviceConfigPath: string;
  obscuraStorageDirectory: string;
  launchAgentPath: string;
  systemdUnitPath: string;
  stdoutLogPath: string;
  stderrLogPath: string;
};

export function installPaths(options: {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
} = {}): InstallPaths {
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const configHome =
    env.XDG_CONFIG_HOME?.trim() || join(homeDirectory, ".config");
  const dataHome =
    env.XDG_DATA_HOME?.trim() ||
    join(homeDirectory, ".local", "share");
  const configDirectory = join(configHome, SERVICE_NAME);
  const dataDirectory = join(dataHome, SERVICE_NAME);

  return {
    homeDirectory,
    configDirectory,
    dataDirectory,
    serviceConfigPath: join(configDirectory, "service.json"),
    obscuraStorageDirectory: join(dataDirectory, "obscura-profile"),
    launchAgentPath: join(
      homeDirectory,
      "Library",
      "LaunchAgents",
      `${LAUNCHD_LABEL}.plist`,
    ),
    systemdUnitPath: join(
      configHome,
      "systemd",
      "user",
      `${SERVICE_NAME}.service`,
    ),
    stdoutLogPath: join(
      homeDirectory,
      "Library",
      "Logs",
      `${SERVICE_NAME}.log`,
    ),
    stderrLogPath: join(
      homeDirectory,
      "Library",
      "Logs",
      `${SERVICE_NAME}.error.log`,
    ),
  };
}

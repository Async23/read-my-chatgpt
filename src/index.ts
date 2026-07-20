#!/usr/bin/env node
import { runCli } from "./cli.js";
import { SERVICE_NAME } from "./install-paths.js";

runCli(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${SERVICE_NAME}] ${message}`);
  process.exitCode = 1;
});

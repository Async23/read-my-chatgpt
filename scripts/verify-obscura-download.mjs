import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureObscuraBinary,
  validateObscuraBinary,
} from "../dist/obscura-installer.js";

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "conversation-reader-obscura-download-"),
);

try {
  const binary = await ensureObscuraBinary({
    env: {
      PATH: "",
      XDG_DATA_HOME: temporaryDirectory,
    },
    homeDirectory: temporaryDirectory,
    log: (message) => console.error(message),
  });
  await validateObscuraBinary(binary, true);
  console.error("verify-obscura-download.mjs: ok");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

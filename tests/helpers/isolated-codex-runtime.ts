import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetCodexRuntimeResolveCacheForTests } from "../../src/codex/runtime";
import { resetBundledCatalogCacheForTests } from "../../src/codex/catalog/bundled";
import { repoPath } from "./repo-root";

/** Discovery fixtures test the catalog, not the developer's installed Codex CLI. */
export function installIsolatedCodexRuntime(root: string): { restore(): void } {
  const previousCliPath = process.env.CODEX_CLI_PATH;
  const scriptPath = join(root, "codex-discovery-fixture.js");
  const catalog = readFileSync(repoPath("src/codex/data/upstream-models.json"), "utf8");
  writeFileSync(scriptPath, [
    'if (process.argv.includes("--version")) console.log("codex-cli 0.145.0");',
    `else process.stdout.write(${JSON.stringify(catalog)});`,
  ].join("\n"));
  const command = join(root, process.platform === "win32"
    ? "codex-discovery-fixture.cmd" : "codex-discovery-fixture");
  if (process.platform === "win32") {
    writeFileSync(command, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);
  } else {
    writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`);
    chmodSync(command, 0o755);
  }
  process.env.CODEX_CLI_PATH = command;
  resetCodexRuntimeResolveCacheForTests();
  resetBundledCatalogCacheForTests();
  return {
    restore() {
      if (previousCliPath === undefined) delete process.env.CODEX_CLI_PATH;
      else process.env.CODEX_CLI_PATH = previousCliPath;
      resetCodexRuntimeResolveCacheForTests();
      resetBundledCatalogCacheForTests();
    },
  };
}

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SPAWN_BUDGET_MS } from "./helpers/test-budget";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const cliPath = join(repoRoot, "src", "cli", "index.ts");
const isolatedCodexHome = mkdtempSync(join(tmpdir(), "ocx-config-codex-home-"));

setDefaultTimeout(SPAWN_BUDGET_MS);

function runCli(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, CODEX_HOME: isolatedCodexHome, ...env },
    encoding: "utf8",
    timeout: SPAWN_BUDGET_MS - 5_000,
  });
}

function freshConfig() {
  const dir = mkdtempSync(join(tmpdir(), "ocx-config-"));
  const config = {
    port: 10100,
    providers: {
      openai: {
        adapter: "openai-responses",
        baseUrl: "https://chatgpt.com/backend-api/codex",
        authMode: "forward",
      },
      blsc: {
        adapter: "openai-chat",
        baseUrl: "https://llmapi.blsc.cn",
        modelCosts: {
          "deepseek-v4-flash": { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
          "sk-abcdef1234567890": { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
        },
      },
    },
    defaultProvider: "openai",
  };
  writeFileSync(join(dir, "config.json"), JSON.stringify(config), "utf8");
  return dir;
}

describe("ocx config display redaction", () => {
  test("config show --json never prints secret-shaped modelCosts keys", () => {
    const dir = freshConfig();
    try {
      const result = runCli(["config", "show", "--json"], { OPENCODEX_HOME: dir });
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("sk-abcdef1234567890");
      const parsed = JSON.parse(result.stdout);
      expect(parsed.providers.blsc.modelCosts).toEqual({
        "deepseek-v4-flash": { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("config get providers.<name>.modelCosts --json drops secret-shaped keys", () => {
    const dir = freshConfig();
    try {
      const result = runCli(["config", "get", "providers.blsc.modelCosts", "--json"], { OPENCODEX_HOME: dir });
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("sk-abcdef1234567890");
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toEqual({
        "deepseek-v4-flash": { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ocx config path updates", () => {
  test("config set creates missing object parents without disturbing existing config", () => {
    const dir = freshConfig();
    try {
      const result = runCli(["config", "set", "clientIntegrations.codex", "catalog-only", "--json"], { OPENCODEX_HOME: dir });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        ok: true,
        path: "clientIntegrations.codex",
        value: "catalog-only",
      });

      const saved = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
      expect(saved.clientIntegrations).toEqual({ codex: "catalog-only" });
      expect(saved.defaultProvider).toBe("openai");
      expect(saved.providers.blsc.baseUrl).toBe("https://llmapi.blsc.cn");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("config set does not replace an existing scalar parent", () => {
    const dir = freshConfig();
    try {
      const result = runCli(["config", "set", "defaultProvider.name", "openai"], { OPENCODEX_HOME: dir });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("config parent path not found: defaultProvider");

      const saved = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
      expect(saved.defaultProvider).toBe("openai");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("config set does not replace an existing array parent", () => {
    const dir = freshConfig();
    try {
      const configPath = join(dir, "config.json");
      const original = JSON.parse(readFileSync(configPath, "utf8"));
      original.providers.openai.aliases = [];
      writeFileSync(configPath, JSON.stringify(original), "utf8");

      const result = runCli(["config", "set", "providers.openai.aliases.default", "gpt-5"], { OPENCODEX_HOME: dir });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("config parent path not found: aliases");

      const saved = JSON.parse(readFileSync(configPath, "utf8"));
      expect(saved.providers.openai.aliases).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("config unset does not create missing object parents", () => {
    const dir = freshConfig();
    try {
      const result = runCli(["config", "unset", "clientIntegrations.codex"], { OPENCODEX_HOME: dir });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("config parent path not found: clientIntegrations");

      const saved = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
      expect(saved.clientIntegrations).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { useCallback, useState } from "react";
import { useDataSurface } from "../../data-surface";
import { navigateHash } from "../../hash-routing";
import { useT, type TKey } from "../../i18n/shared";
import { Notice } from "../../ui";
import {
  loadNativeIntegrations,
  setCodexIntegrationMode,
  type CodexIntegrationMode,
  type NativeStatus,
} from "./native-api";

const MODES: readonly CodexIntegrationMode[] = ["full", "catalog-only", "off"];

const LABEL_KEY: Record<CodexIntegrationMode, TKey> = {
  full: "integrations.codex.mode.full",
  "catalog-only": "integrations.codex.mode.catalogOnly",
  off: "integrations.codex.mode.off",
};

const DESCRIPTION_KEY: Record<CodexIntegrationMode, TKey> = {
  full: "integrations.codex.modeDescription.full",
  "catalog-only": "integrations.codex.modeDescription.catalogOnly",
  off: "integrations.codex.modeDescription.off",
};

function resolvedMode(status: NativeStatus): CodexIntegrationMode {
  return status.mode ?? (status.desiredEnabled ? "full" : "off");
}

export default function CodexIntegrationPage({
  apiBase,
  active = true,
}: {
  apiBase: string;
  active?: boolean;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [mutationFailed, setMutationFailed] = useState(false);
  const fetchStatus = useCallback(
    async (signal: AbortSignal) => {
      const envelope = await loadNativeIntegrations(apiBase, signal);
      const status = envelope?.clients.find(row => row.clientId === "codex") ?? null;
      if (!status) throw new Error("Codex integration status is unavailable");
      return status;
    },
    [apiBase],
  );
  const resource = useDataSurface<NativeStatus>(
    `integration-codex-mode:${apiBase}`,
    [apiBase],
    fetchStatus,
    { isEmpty: () => false, enabled: active },
  );
  const status = resource.state.data ?? null;
  const mode = status ? resolvedMode(status) : null;
  const disabled = !status || pending || resource.state.refreshing;

  const selectMode = async (next: CodexIntegrationMode) => {
    if (disabled || next === mode) return;
    setPending(true);
    setMutationFailed(false);
    try {
      await setCodexIntegrationMode(apiBase, next);
      resource.refresh();
    } catch {
      setMutationFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="integration-native-page codex-integration-page" aria-labelledby="codex-integration-title">
      <h3 id="codex-integration-title">{t("integrations.codex.title")}</h3>
      <p>{t("integrations.codex.body")}</p>

      {!status && resource.state.kind !== "failed-cold" && (
        <p className="page-sub">{t("common.loading")}</p>
      )}
      {(resource.state.showError || resource.state.kind === "failed-cold" || mutationFailed) && (
        <Notice tone="err">{t(status ? "integrations.error.stale" : "integrations.error.load")}</Notice>
      )}

      <div className="codex-mode-row">
        <span className="codex-mode-label">{t("integrations.codex.modeLabel")}</span>
        <div className="codex-mode-segmented" role="radiogroup" aria-label={t("integrations.codex.modeLabel")}>
          {MODES.map(option => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              className={`btn btn-sm${mode === option ? " btn-primary" : " btn-ghost"}`}
              disabled={disabled}
              onClick={() => void selectMode(option)}
            >
              {t(LABEL_KEY[option])}
            </button>
          ))}
        </div>
      </div>
      {mode && <p className="codex-mode-description">{t(DESCRIPTION_KEY[mode])}</p>}

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => navigateHash("startup")}
      >
        {t("integrations.codex.openService")}
      </button>
    </section>
  );
}

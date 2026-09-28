import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGS, type Lang } from "../i18n";
import type { Profile, Status } from "../lib/types";
import { Badge, Button, Panel } from "./primitives";

export interface StatusBarProps {
  status: Status | null;
  activeProfile: Profile | null;
  pending: boolean;
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  onReapply: () => void;
  onCapture: () => void;
}

const DRIFT_TONE = {
  inSync: "good",
  drifted: "warn",
  noActive: "neutral",
  configMissing: "bad",
  configInvalid: "bad",
} as const;

export function StatusBar({
  status,
  activeProfile,
  pending,
  lang,
  onLangChange,
  onReapply,
  onCapture,
}: StatusBarProps) {
  const { t } = useTranslation();
  const nextLang: Lang = lang === "ja" ? "en" : "ja";

  return (
    <Panel className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex flex-col">
          <h1 className="text-base font-semibold text-ink-900 dark:text-ink-50">OmOswitch</h1>
          <p className="text-micro text-ink-500 dark:text-ink-400">{t("app.subtitle")}</p>
        </div>

        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 border-l border-ink-200 pl-6 dark:border-ink-800"
          aria-live="polite"
        >
          <div className="flex min-w-0 flex-col">
            <span className="text-micro text-ink-500 dark:text-ink-400">{t("status.activeProfile")}</span>
            <span
              data-testid="active-profile-name"
              className={`truncate text-sm font-semibold ${
                activeProfile === null ? "text-ink-500 dark:text-ink-400" : "text-ink-900 dark:text-ink-50"
              }`}
            >
              {activeProfile?.name ?? t("status.noActive")}
            </span>
          </div>
          {status === null ? (
            <Badge>{t("common.loading")}</Badge>
          ) : pending ? (
            <Badge tone="warn">{t("status.pending")}</Badge>
          ) : status.drift === "noActive" ? null : (
            <Badge tone={DRIFT_TONE[status.drift]}>{t(`status.${status.drift}`)}</Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-micro text-ink-500 dark:text-ink-400">{t("lang.label")}</span>
          <Button size="sm" aria-label={t("lang.toggle")} onClick={() => onLangChange(nextLang)}>
            {t(`lang.${nextLang}`)}
          </Button>
          <span className="sr-only">
            {SUPPORTED_LANGS.map((entry) => t(`lang.${entry}`)).join(" / ")}
          </span>
        </div>
      </div>

      {status === null ? null : (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-ink-200 pt-2 dark:border-ink-800">
          <Badge>
            {status.nativeBlockPresent ? t("status.nativeBlockPresent") : t("status.nativeBlockAbsent")}
          </Badge>
          {status.legacySenpiPresent ? <Badge tone="warn">{t("status.legacySenpi")}</Badge> : null}
          {status.omoAvailable ? null : <Badge tone="warn">{t("status.omoMissing")}</Badge>}
          <span
            className="ml-auto min-w-0 truncate font-mono text-micro text-ink-600 dark:text-ink-300"
            title={status.configPath}
          >
            {status.configPath}
          </span>
        </div>
      )}

      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-warn-500/14 px-3 py-2">
          <p className="flex-1 text-sm font-medium text-warn-700 dark:text-warn-300">
            {t("applyState.pending")}
          </p>
          <Button size="sm" variant="primary" onClick={onReapply}>
            {t("applyState.applyNow")}
          </Button>
        </div>
      ) : status?.drift === "drifted" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-warn-500/14 px-3 py-2">
          <p className="flex-1 text-sm text-ink-800 dark:text-ink-100">{t("drift.notice")}</p>
          <Button size="sm" variant="primary" onClick={onReapply}>
            {t("drift.reapply")}
          </Button>
          <Button size="sm" onClick={onCapture}>
            {t("drift.capture")}
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

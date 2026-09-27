import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGS, type Lang } from "../i18n";
import type { Profile, Status } from "../lib/types";
import { Badge, Button, Panel } from "./primitives";

export interface StatusBarProps {
  status: Status | null;
  activeProfile: Profile | null;
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
  lang,
  onLangChange,
  onReapply,
  onCapture,
}: StatusBarProps) {
  const { t } = useTranslation();
  const nextLang: Lang = lang === "ja" ? "en" : "ja";

  return (
    <Panel className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold text-ink-900 dark:text-ink-50">OmOswitch</h1>
          <p className="text-micro text-ink-500 dark:text-ink-400">{t("app.subtitle")}</p>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5" aria-live="polite">
          <span className="text-micro text-ink-500 dark:text-ink-400">
            {t("status.activeProfile")}:{" "}
            <span className="font-medium text-ink-800 dark:text-ink-100">
              {activeProfile?.name ?? t("status.noActive")}
            </span>
          </span>

          {status === null ? (
            <Badge>{t("common.loading")}</Badge>
          ) : (
            <>
              <Badge tone={DRIFT_TONE[status.drift]}>{t(`status.${status.drift}`)}</Badge>
              <Badge>
                {status.nativeBlockPresent
                  ? t("status.nativeBlockPresent")
                  : t("status.nativeBlockAbsent")}
              </Badge>
              {status.legacySenpiPresent ? <Badge tone="warn">{t("status.legacySenpi")}</Badge> : null}
              {status.omoAvailable ? null : <Badge tone="warn">{t("status.omoMissing")}</Badge>}
              <span
                className="min-w-0 truncate font-mono text-micro text-ink-500 dark:text-ink-400"
                title={status.configPath}
              >
                {status.configPath}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-micro text-ink-500 dark:text-ink-400">{t("lang.label")}</span>
          <Button
            size="sm"
            aria-label={t("lang.toggle")}
            onClick={() => onLangChange(nextLang)}
          >
            {t(`lang.${nextLang}`)}
          </Button>
          <span className="sr-only">
            {SUPPORTED_LANGS.map((entry) => t(`lang.${entry}`)).join(" / ")}
          </span>
        </div>
      </div>

      {status?.drift === "drifted" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-warn-500/12 px-3 py-2">
          <p className="flex-1 text-xs text-ink-700 dark:text-ink-200">{t("drift.notice")}</p>
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

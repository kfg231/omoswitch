import { useTranslation } from "react-i18next";
import type { AppError, AppErrorKind } from "../lib/types";
import { Button } from "./primitives";

const KNOWN_KINDS: readonly AppErrorKind[] = [
  "configMissing",
  "malformedJsonc",
  "duplicateKey",
  "changedOnDisk",
  "verifyFailed",
  "omoNotFound",
  "omoListParse",
  "io",
  "storeCorrupt",
  "profileNotFound",
  "invalidProfile",
  "notAnObject",
  "providerNotFound",
  "invalidProvider",
  "networkUnreachable",
  "modelFetchParse",
];

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; message?: unknown };
  return (
    typeof candidate.message === "string" &&
    KNOWN_KINDS.some((kind) => kind === candidate.kind)
  );
}

export interface ErrorBannerProps {
  error: AppError;
  onDismiss: () => void;
  onReloadPreview?: () => void;
}

export function ErrorBanner({ error, onDismiss, onReloadPreview }: ErrorBannerProps) {
  const { t } = useTranslation();
  const message = t(`error.${error.kind}`, {
    line: error.line ?? 0,
    col: error.col ?? 0,
    key: error.key ?? "",
    field: error.field ?? "",
  });

  return (
    <div
      role="alert"
      className="rounded-panel flex flex-wrap items-start gap-3 bg-bad-500/12 px-4 py-3 ring-1 ring-ink-200 dark:ring-ink-800"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-bad-500">{t("error.title")}</p>
        <p className="text-sm text-ink-800 dark:text-ink-100">{message}</p>
        <p className="mt-0.5 font-mono text-micro break-all text-ink-500 dark:text-ink-400">
          {error.message}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {error.kind === "changedOnDisk" && onReloadPreview !== undefined ? (
          <Button size="sm" variant="primary" onClick={onReloadPreview}>
            {t("preview.reload")}
          </Button>
        ) : null}
        <Button size="sm" onClick={onDismiss}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}

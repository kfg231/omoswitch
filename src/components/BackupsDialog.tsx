import { useTranslation } from "react-i18next";
import type { BackupInfo } from "../lib/types";
import { Dialog } from "./Dialog";
import { Button } from "./primitives";

export interface BackupsDialogProps {
  backups: readonly BackupInfo[];
  busy: boolean;
  onRestore: (path: string) => void;
  onClose: () => void;
}

export function BackupsDialog({ backups, busy, onRestore, onClose }: BackupsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      title={t("backups.title")}
      wide
      onClose={onClose}
      footer={
        <Button size="sm" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      {backups.length === 0 ? (
        <p className="text-xs text-ink-500 dark:text-ink-400">{t("backups.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {backups.map((backup) => (
            <li
              key={backup.path}
              className="rounded-panel flex flex-wrap items-center gap-3 bg-ink-100/70 px-3 py-2 ring-1 ring-ink-200 dark:bg-ink-950/50 dark:ring-ink-800"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs break-all text-ink-800 dark:text-ink-100">
                  {backup.path}
                </p>
                <p className="text-micro text-ink-500 dark:text-ink-400">
                  {t("backups.createdAt")}: {backup.createdAt} · {t("backups.size")}:{" "}
                  {backup.sizeBytes}
                </p>
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("backups.restoreConfirm"))) onRestore(backup.path);
                }}
              >
                {t("backups.restore")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

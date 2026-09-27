import { useTranslation } from "react-i18next";
import type { Profile, SwitchPreview as SwitchPreviewData } from "../lib/types";
import { Dialog } from "./Dialog";
import { Badge, Button, SectionHeading } from "./primitives";

export interface SwitchPreviewProps {
  preview: SwitchPreviewData;
  profile: Profile | null;
  busy: boolean;
  onConfirm: () => void;
  onReload: () => void;
  onClose: () => void;
}

export function SwitchPreview({
  preview,
  profile,
  busy,
  onConfirm,
  onReload,
  onClose,
}: SwitchPreviewProps) {
  const { t } = useTranslation();

  const blocks: readonly { title: string; text: string }[] = [
    { title: t("preview.before"), text: preview.beforeNative },
    { title: t("preview.after"), text: preview.afterNative },
  ];

  return (
    <Dialog
      title={t("preview.title")}
      wide
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onReload}>
            {t("preview.reload")}
          </Button>
          <Button size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={onConfirm}>
            {t("preview.applyButton")}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink-800 dark:text-ink-100">
          {profile?.name ?? t("status.noActive")}
        </span>
        <Badge tone={preview.changed ? "warn" : "good"}>
          {preview.changed ? t("preview.changed") : t("preview.unchanged")}
        </Badge>
        <span className="font-mono text-micro text-ink-500 dark:text-ink-400">
          {t("status.configHash")}: {preview.baseHash.slice(0, 16)}
        </span>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {blocks.map((block) => (
          <div key={block.title} className="flex min-w-0 flex-col gap-1.5">
            <SectionHeading>{block.title}</SectionHeading>
            <pre className="max-h-72 overflow-auto rounded-md bg-ink-100 p-3 font-mono text-xs whitespace-pre text-ink-800 ring-1 ring-ink-200 dark:bg-ink-950 dark:text-ink-200 dark:ring-ink-800">
              {block.text}
            </pre>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ImportSource } from "../lib/api";
import type { ImportResult } from "../lib/types";
import { Dialog } from "./Dialog";
import { Button, Field, TextInput } from "./primitives";

export interface ImportDialogProps {
  result: ImportResult | null;
  busy: boolean;
  onSubmit: (source: ImportSource, name: string) => void;
  onClose: () => void;
}

const SOURCES: readonly ImportSource[] = ["opencode", "native"];

export function ImportDialog({ result, busy, onSubmit, onClose }: ImportDialogProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<ImportSource>("opencode");
  const [name, setName] = useState("");

  return (
    <Dialog
      title={t("import.title")}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || name.trim() === ""}
            onClick={() => onSubmit(source, name.trim())}
          >
            {t("import.submit")}
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-micro font-medium tracking-wide text-ink-500 uppercase dark:text-ink-400">
          {t("import.source")}
        </legend>
        {SOURCES.map((candidate) => (
          <label
            key={candidate}
            className="flex items-center gap-2 text-sm text-ink-800 dark:text-ink-100"
          >
            <input
              type="radio"
              name="import-source"
              value={candidate}
              checked={source === candidate}
              onChange={() => setSource(candidate)}
              className="accent-accent-500"
            />
            {candidate === "opencode" ? t("import.sourceOpencode") : t("import.sourceNative")}
          </label>
        ))}
      </fieldset>

      <div className="mt-4">
        <Field label={t("import.name")}>
          {(field) => (
            <TextInput
              {...field}
              value={name}
              placeholder={t("editor.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
      </div>

      {result !== null ? (
        <div className="mt-4 rounded-md bg-good-500/12 px-3 py-2">
          <p className="text-sm text-ink-800 dark:text-ink-100">
            {t("import.done", { name: result.profile.name })}
          </p>
          {result.renamed.length > 0 ? (
            <>
              <p className="mt-1.5 text-xs font-medium text-ink-700 dark:text-ink-200">
                {t("import.renamedNotice")}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {result.renamed.map(([from, to]) => (
                  <li key={from} className="font-mono text-micro text-ink-600 dark:text-ink-300">
                    {t("import.renamedItem", { from, to })}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

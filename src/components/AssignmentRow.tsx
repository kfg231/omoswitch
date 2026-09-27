import { useState } from "react";
import { useTranslation } from "react-i18next";
import { mergeAssignment, splitAssignment } from "../lib/assignment";
import { REASONING_LEVELS, isReasoning } from "../lib/catalog";
import type { Assignment, ModelInfo } from "../lib/types";
import { ModelPicker } from "./ModelPicker";
import { Button, Field, IconButton, Select, TextArea, TextInput } from "./primitives";

export interface AssignmentRowProps {
  entryKey: string;
  assignment: Assignment;
  models: readonly ModelInfo[];
  omoAvailable: boolean;
  keyError?: string;
  modelError?: string;
  onChange: (next: Assignment) => void;
  onRemove: () => void;
  onRefreshModels: () => void;
}

function stringifyExtra(extra: Record<string, unknown>): string {
  return Object.keys(extra).length === 0 ? "" : JSON.stringify(extra, null, 2);
}

export function AssignmentRow({
  entryKey,
  assignment,
  models,
  omoAvailable,
  keyError,
  modelError,
  onChange,
  onRemove,
  onRefreshModels,
}: AssignmentRowProps) {
  const { t } = useTranslation();
  const parts = splitAssignment(assignment);
  const order = Object.keys(assignment);
  const [extraText, setExtraText] = useState(() => stringifyExtra(parts.extra));
  const [extraError, setExtraError] = useState(false);
  const [fallbackDraft, setFallbackDraft] = useState("");

  function update(next: Partial<typeof parts>): void {
    onChange(mergeAssignment({ ...parts, ...next }, order));
  }

  function commitExtra(raw: string): void {
    setExtraText(raw);
    if (raw.trim() === "") {
      setExtraError(false);
      update({ extra: {} });
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setExtraError(true);
        return;
      }
      setExtraError(false);
      update({ extra: parsed as Record<string, unknown> });
    } catch {
      setExtraError(true);
    }
  }

  function addFallback(): void {
    const value = fallbackDraft.trim();
    if (value === "") return;
    setFallbackDraft("");
    update({ models: [...parts.models, value] });
  }

  return (
    <li className="rounded-panel bg-ink-100/70 p-3 ring-1 ring-ink-200 dark:bg-ink-950/50 dark:ring-ink-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="sm:w-44">
          <Field label={t("editor.key")} error={keyError}>
            {(field) => (
              <TextInput
                {...field}
                value={entryKey}
                readOnly
                className="font-mono text-xs"
              />
            )}
          </Field>
        </div>
        <div className="flex-1">
          <Field label={t("editor.model")} error={modelError}>
            {(field) => (
              <ModelPicker
                id={field.id}
                describedBy={field["aria-describedby"]}
                value={parts.model}
                models={models}
                omoAvailable={omoAvailable}
                onChange={(model) => update({ model })}
                onRefresh={onRefreshModels}
              />
            )}
          </Field>
        </div>
        <div className="sm:w-36">
          <Field label={t("editor.reasoning")}>
            {(field) => (
              <Select
                {...field}
                value={parts.reasoning ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  update({ reasoning: isReasoning(raw) ? raw : null });
                }}
              >
                <option value="">{t("reasoning.unset")}</option>
                {REASONING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`reasoning.${level}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <IconButton label={t("editor.removeEntry")} onClick={onRemove} className="sm:mt-5">
          <span aria-hidden="true">✕</span>
        </IconButton>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Field label={t("editor.fallbackModels")} labelHidden={false}>
            {(field) => (
              <div className="flex items-center gap-1.5">
                <TextInput
                  {...field}
                  value={fallbackDraft}
                  placeholder={t("editor.fallbackPlaceholder")}
                  className="font-mono text-xs"
                  onChange={(event) => setFallbackDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addFallback();
                    }
                  }}
                />
                <Button size="sm" onClick={addFallback}>
                  {t("editor.addFallback")}
                </Button>
              </div>
            )}
          </Field>
          {parts.models.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {parts.models.map((model, index) => (
                <li
                  key={`${model}-${index}`}
                  className="inline-flex items-center gap-1 rounded-full bg-ink-200/70 py-0.5 pr-1 pl-2 font-mono text-micro text-ink-700 dark:bg-ink-800 dark:text-ink-200"
                >
                  {model}
                  <IconButton
                    label={t("editor.removeFallback", { model })}
                    className="size-4 text-micro"
                    onClick={() =>
                      update({ models: parts.models.filter((_, position) => position !== index) })
                    }
                  >
                    <span aria-hidden="true">✕</span>
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Field
          label={t("editor.extra")}
          error={extraError ? t("editor.extraInvalid") : undefined}
        >
          {(field) => (
            <TextArea
              {...field}
              rows={3}
              value={extraText}
              placeholder={t("editor.extraPlaceholder")}
              onChange={(event) => commitExtra(event.target.value)}
            />
          )}
        </Field>
      </div>
    </li>
  );
}

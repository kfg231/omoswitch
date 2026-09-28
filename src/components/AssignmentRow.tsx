import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { mergeAssignment, splitAssignment } from "../lib/assignment";
import { findDeadProviders } from "../lib/deadReference";
import {
  REASONING_LEVELS,
  isNativeAgent,
  isNativeCategory,
  isReasoning,
  legacyAgentTarget,
  legacyCategoryTarget,
} from "../lib/catalog";
import type { Assignment, ModelInfo, ProviderInfo } from "../lib/types";
import { ModelPicker } from "./ModelPicker";
import { Badge, Button, Field, IconButton, Select, TextArea, TextInput } from "./primitives";

export const ASSIGNMENT_GRID = "sm:grid-cols-[11rem_minmax(0,1fr)_9.5rem_2rem]";

export interface AssignmentRowProps {
  entryKey: string;
  section: "agents" | "categories";
  assignment: Assignment;
  models: readonly ModelInfo[];
  providers: readonly ProviderInfo[];
  omoAvailable: boolean;
  onConfigureProvider: (providerId: string) => void;
  keyError?: string;
  modelError?: string;
  onChange: (next: Assignment) => void;
  onRemove: () => void;
  onRefreshModels: () => Promise<void>;
  knownKeys: readonly string[];
}

function stringifyExtra(extra: Record<string, unknown>): string {
  return Object.keys(extra).length === 0 ? "" : JSON.stringify(extra, null, 2);
}

export function AssignmentRow({
  entryKey,
  section,
  assignment,
  models,
  providers,
  omoAvailable,
  onConfigureProvider,
  keyError,
  modelError,
  onChange,
  onRemove,
  onRefreshModels,
  knownKeys,
}: AssignmentRowProps) {
  const { t } = useTranslation();
  const parts = splitAssignment(assignment);
  const order = Object.keys(assignment);
  const [extraText, setExtraText] = useState(() => stringifyExtra(parts.extra));
  const [extraError, setExtraError] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [fallbackDraft, setFallbackDraft] = useState("");
  const [fallbackRevision, setFallbackRevision] = useState(0);
  const extraPanelId = useId();

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

  function addFallback(raw: string, remount: boolean): void {
    const value = raw.trim();
    if (value === "") return;
    setFallbackDraft("");
    // A list pick already remounts the picker's input; the "+" button path must reset it here.
    if (remount) setFallbackRevision((current) => current + 1);
    update({ models: [...parts.models, value] });
  }

  const deadProviders = findDeadProviders([parts.model, ...parts.models], models, providers);

  const known =
    section === "agents" ? isNativeAgent(entryKey, knownKeys) : isNativeCategory(entryKey, knownKeys);
  const legacyTarget =
    section === "agents" ? legacyAgentTarget(entryKey) : legacyCategoryTarget(entryKey);
  const unknownHint = known
    ? null
    : legacyTarget !== null
      ? t("editor.legacyKeyHint", { key: entryKey, target: legacyTarget })
      : t(section === "agents" ? "editor.unknownAgentHint" : "editor.unknownCategoryHint", {
          key: entryKey,
        });

  const extraKeys = Object.keys(parts.extra).length;
  // Invalid JSON must stay visible so the error is never hidden behind the toggle.
  const showExtra = extraOpen || extraError;

  return (
    <li className="rounded-lg bg-ink-100/60 p-3 ring-1 ring-ink-200 dark:bg-ink-950/50 dark:ring-ink-800">
      <div className={`grid grid-cols-1 gap-x-3 gap-y-2 ${ASSIGNMENT_GRID}`}>
        <div className="flex min-w-0 flex-col gap-1 sm:row-span-2">
          <Field label={t("editor.key")} labelHidden error={keyError} hint={unknownHint ?? undefined}>
            {(field) => (
              <TextInput
                {...field}
                value={entryKey}
                readOnly
                className="bg-ink-100 font-mono font-medium dark:bg-ink-900"
              />
            )}
          </Field>
          {unknownHint !== null ? (
            <div title={unknownHint}>
              <Badge tone="warn">
                {t(legacyTarget !== null ? "editor.legacyKeyBadge" : "editor.unknownKeyBadge")}
              </Badge>
            </div>
          ) : null}
        </div>

        <Field label={t("editor.model")} labelHidden error={modelError}>
          {(field) => (
            <ModelPicker
              id={field.id}
              describedBy={field["aria-describedby"]}
              value={parts.model}
              models={models}
              providers={providers}
              omoAvailable={omoAvailable}
              onChange={(model) => update({ model })}
              onRefresh={onRefreshModels}
            />
          )}
        </Field>

        <Field label={t("editor.reasoning")} labelHidden>
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

        <IconButton label={t("editor.removeEntry")} onClick={onRemove} className="justify-self-end">
          <span aria-hidden="true">✕</span>
        </IconButton>

        <div className="flex min-w-0 flex-col gap-1.5 sm:col-start-2">
          <Field label={t("editor.fallbackModels")}>
            {(field) => (
              <ModelPicker
                key={fallbackRevision}
                id={field.id}
                describedBy={field["aria-describedby"]}
                value={fallbackDraft}
                models={models}
                providers={providers}
                omoAvailable={omoAvailable}
                onChange={setFallbackDraft}
                onRefresh={onRefreshModels}
                onPick={(model) => addFallback(model, false)}
                trailing={
                  <Button
                    aria-label={t("editor.addFallback")}
                    title={t("editor.addFallback")}
                    size="icon"
                    onClick={() => addFallback(fallbackDraft, true)}
                  >
                    <span aria-hidden="true">+</span>
                  </Button>
                }
              />
            )}
          </Field>
          {parts.models.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {parts.models.map((model, index) => (
                <li
                  key={`${model}-${index}`}
                  className="inline-flex items-center gap-1 rounded-md bg-white py-0.5 pr-0.5 pl-2 font-mono text-xs text-ink-800 ring-1 ring-ink-300 dark:bg-ink-900 dark:text-ink-100 dark:ring-ink-700"
                >
                  <span className="mr-0.5 text-micro text-ink-500 tabular-nums dark:text-ink-400">
                    {index + 1}
                  </span>
                  {model}
                  <IconButton
                    label={t("editor.removeFallback", { model })}
                    className="size-5 text-micro"
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

        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-ink-600 dark:text-ink-300">
            {t("editor.extraShort")}
          </span>
          <button
            type="button"
            aria-expanded={showExtra}
            aria-controls={extraPanelId}
            onClick={() => setExtraOpen((current) => !current)}
            className="inline-flex h-8 items-center justify-between gap-1.5 rounded-md bg-white px-2.5 text-sm text-ink-700 ring-1 ring-ink-300 transition-colors duration-150 ease-ui hover:ring-ink-400 dark:bg-ink-950 dark:text-ink-200 dark:ring-ink-700 dark:hover:ring-ink-600"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="font-mono text-xs">JSON</span>
              {extraError ? (
                <Badge tone="bad">{t("editor.extraErrorBadge")}</Badge>
              ) : extraKeys > 0 ? (
                <Badge tone="accent">{t("editor.extraCount", { count: extraKeys })}</Badge>
              ) : (
                <span className="text-micro text-ink-500 dark:text-ink-400">{t("editor.extraEmpty")}</span>
              )}
            </span>
            <span
              aria-hidden="true"
              className={`text-micro text-ink-500 transition-transform duration-150 ease-ui ${showExtra ? "rotate-180" : ""}`}
            >
              ▾
            </span>
          </button>
        </div>

        {showExtra ? (
          <div id={extraPanelId} className="sm:col-span-3 sm:col-start-2">
            <Field
              label={t("editor.extra")}
              labelHidden
              error={extraError ? t("editor.extraInvalid") : undefined}
            >
              {(field) => (
                <TextArea
                  {...field}
                  rows={4}
                  value={extraText}
                  placeholder={t("editor.extraPlaceholder")}
                  onChange={(event) => commitExtra(event.target.value)}
                />
              )}
            </Field>
          </div>
        ) : null}

        {deadProviders.map((providerId) => (
          <div
            key={providerId}
            role="status"
            data-testid={`dead-reference-${providerId}`}
            className="flex flex-wrap items-center gap-3 rounded-md bg-warn-500/12 px-3 py-2 sm:col-span-3 sm:col-start-2"
          >
            <p className="min-w-0 flex-1 text-sm text-ink-800 dark:text-ink-100">
              <span aria-hidden="true" className="mr-1.5 font-semibold text-warn-700 dark:text-warn-300">
                !
              </span>
              {t("provider.deadReference", { provider: providerId })}
            </p>
            <Button
              size="sm"
              variant="primary"
              data-testid={`configure-provider-${providerId}`}
              onClick={() => onConfigureProvider(providerId)}
            >
              {t("provider.configureProvider")}
            </Button>
          </div>
        ))}
      </div>
    </li>
  );
}

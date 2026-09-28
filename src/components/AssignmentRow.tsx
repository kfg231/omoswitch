import { useEffect, useRef, useState } from "react";
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
import { ImeSafeInput } from "./ImeSafeInput";
import { ModelPicker } from "./ModelPicker";
import { Badge, Button, Field, IconButton, Select, TextArea, TextInput } from "./primitives";

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
  const [fallbackDraft, setFallbackDraft] = useState("");
  const [fallbackRevision, setFallbackRevision] = useState(0);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const refocusFallback = useRef(false);

  useEffect(() => {
    if (refocusFallback.current) {
      refocusFallback.current = false;
      fallbackRef.current?.focus();
    }
  }, [fallbackRevision]);

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

  function addFallback(raw: string, refocus: boolean): void {
    const value = raw.trim();
    if (value === "") return;
    setFallbackDraft("");
    // Remount the IME-safe input so its internal draft resets to empty.
    refocusFallback.current = refocus;
    setFallbackRevision((current) => current + 1);
    update({ models: [...parts.models, value] });
  }

  const deadProviders = findDeadProviders(
    [parts.model, ...parts.models],
    models,
    providers,
  );

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

  return (
    <li className="rounded-panel bg-ink-100/70 p-3 ring-1 ring-ink-200 dark:bg-ink-950/50 dark:ring-ink-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="sm:w-44">
          <Field label={t("editor.key")} error={keyError} hint={unknownHint ?? undefined}>
            {(field) => (
              <TextInput
                {...field}
                value={entryKey}
                readOnly
                className="font-mono text-xs"
              />
            )}
          </Field>
          {unknownHint !== null ? (
            <div className="mt-1" title={unknownHint}>
              <Badge tone="warn">
                {t(legacyTarget !== null ? "editor.legacyKeyBadge" : "editor.unknownKeyBadge")}
              </Badge>
            </div>
          ) : null}
        </div>
        <div className="flex-1">
          <Field label={t("editor.model")} error={modelError}>
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

      {deadProviders.map((providerId) => (
        <div
          key={providerId}
          role="status"
          data-testid={`dead-reference-${providerId}`}
          className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-warn-500/12 px-3 py-2"
        >
          <p className="min-w-0 flex-1 text-xs text-ink-700 dark:text-ink-200">
            <span aria-hidden="true" className="mr-1.5 font-semibold text-warn-500">
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

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Field label={t("editor.fallbackModels")} labelHidden={false}>
            {(field) => (
              <div className="flex items-center gap-1.5">
                <ImeSafeInput
                  {...field}
                  key={fallbackRevision}
                  ref={fallbackRef}
                  value={fallbackDraft}
                  placeholder={t("editor.fallbackPlaceholder")}
                  className="font-mono text-xs"
                  onCommit={setFallbackDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      addFallback(event.currentTarget.value, true);
                    }
                  }}
                />
                <Button size="sm" onClick={() => addFallback(fallbackDraft, false)}>
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

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Effort, ModelInput, ModelThinking, ProviderModel } from "../lib/types";
import { ImeSafeInput } from "./ImeSafeInput";
import { Badge, Button, Field, SectionHeading, Select } from "./primitives";

export interface ProviderModelsTableProps {
  models: ProviderModel[];
  onChange: (models: ProviderModel[]) => void;
  onValidityChange?: (valid: boolean) => void;
  fetched?: string[] | null;
}

export const EFFORTS: readonly Effort[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
export const MODEL_INPUTS: readonly ModelInput[] = ["text", "image"];
export const MANAGED_MODEL_KEYS: readonly string[] = [
  "id",
  "name",
  "reasoning",
  "contextWindow",
  "maxTokens",
  "input",
  "thinking",
];

type CountKey = "contextWindow" | "maxTokens";

interface ModelRow {
  rowId: string;
  model: ProviderModel;
  invalid: Record<string, string>;
}

let rowCounter = 0;

function toRows(models: ProviderModel[]): ModelRow[] {
  return models.map((model) => ({ rowId: `row-${rowCounter++}`, model, invalid: {} }));
}

function withKey(model: ProviderModel, key: string, value: unknown): ProviderModel {
  const next: ProviderModel = { ...model };
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

export function parseCount(raw: string): number | undefined | null {
  const text = raw.trim().replace(/[,_]/g, "");
  if (text === "") return undefined;
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

type ParsedValue = { ok: true; value: unknown } | { ok: false };

export function parseExtraValue(raw: string): ParsedValue {
  const text = raw.trim();
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    if (text.startsWith("{") || text.startsWith("[")) return { ok: false };
    return { ok: true, value: raw };
  }
}

function effortsOf(thinking: ModelThinking | undefined): Effort[] {
  const listed = thinking?.efforts ?? [];
  return EFFORTS.filter((effort) => listed.includes(effort));
}

export function applyEfforts(model: ProviderModel, efforts: Effort[]): ProviderModel {
  const ordered = EFFORTS.filter((effort) => efforts.includes(effort));
  const current = model.thinking;
  const isEffortMode = current === undefined || current.mode === "effort";
  if (ordered.length === 0) {
    if (isEffortMode) return withKey(model, "thinking", undefined);
    const kept: ModelThinking = { ...current };
    delete kept.efforts;
    delete kept.defaultLevel;
    return withKey(model, "thinking", kept);
  }
  const next: ModelThinking = isEffortMode
    ? { ...(current ?? {}), mode: "effort", efforts: ordered }
    : { ...current, efforts: ordered };
  if (next.defaultLevel !== undefined && !ordered.includes(next.defaultLevel)) {
    delete next.defaultLevel;
  }
  return withKey(model, "thinking", next);
}

function extrasOf(model: ProviderModel): [string, unknown][] {
  return Object.entries(model).filter(([key]) => !MANAGED_MODEL_KEYS.includes(key));
}

export function ProviderModelsTable({ models, onChange, onValidityChange, fetched }: ProviderModelsTableProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ModelRow[]>(() => toRows(models));
  const [selectedFetched, setSelectedFetched] = useState<Set<string>>(new Set());
  const emitted = useRef<ProviderModel[]>(models);

  useEffect(() => {
    if (models === emitted.current) return;
    emitted.current = models;
    setRows(toRows(models));
  }, [models]);

  const valid = rows.every((row) => Object.keys(row.invalid).length === 0);
  useEffect(() => {
    onValidityChange?.(valid);
  }, [valid, onValidityChange]);

  function commit(next: ModelRow[]): void {
    setRows(next);
    const list = next.map((row) => row.model);
    const changed =
      list.length !== emitted.current.length || list.some((model, index) => model !== emitted.current[index]);
    if (changed) {
      emitted.current = list;
      onChange(list);
    }
  }

  function patchRow(rowId: string, patch: (row: ModelRow) => ModelRow): void {
    commit(rows.map((row) => (row.rowId === rowId ? patch(row) : row)));
  }

  function addRow(): void {
    commit([...rows, ...toRows([{ id: "" }])]);
  }

  function removeRow(rowId: string): void {
    commit(rows.filter((row) => row.rowId !== rowId));
  }

  function addSelectedFetched(): void {
    const existingIds = new Set(rows.map((row) => row.model.id));
    const toAdd = Array.from(selectedFetched).filter((id) => !existingIds.has(id));
    commit([...rows, ...toRows(toAdd.map((id) => ({ id })))]);
    setSelectedFetched(new Set());
  }

  const fetchedFiltered = fetched?.filter((id) => !rows.some((row) => row.model.id === id)) ?? [];

  return (
    <div data-testid="models-table">
      <div className="flex items-center justify-between gap-2">
        <SectionHeading>{t("provider.models")}</SectionHeading>
        <Button size="sm" onClick={addRow} data-testid="model-add">
          {t("provider.addModel")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{t("provider.noModels")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3" data-testid="model-cards">
          {rows.map((row) => (
            <ModelCard
              key={row.rowId}
              row={row}
              onPatch={(patch) => patchRow(row.rowId, patch)}
              onRemove={() => removeRow(row.rowId)}
            />
          ))}
        </ul>
      )}

      {fetchedFiltered.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <SectionHeading>{t("provider.fetchedModels")}</SectionHeading>
            <Button
              size="sm"
              onClick={addSelectedFetched}
              disabled={selectedFetched.size === 0}
              data-testid="fetched-add"
            >
              {t("provider.addSelected")}
            </Button>
          </div>
          <div className="mt-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-md bg-ink-100 p-2 dark:bg-ink-800/60">
            {fetchedFiltered.map((id) => (
              <label key={id} className="flex items-center gap-2 text-sm text-ink-800 dark:text-ink-100">
                <input
                  type="checkbox"
                  checked={selectedFetched.has(id)}
                  onChange={(e) => {
                    const next = new Set(selectedFetched);
                    if (e.target.checked) {
                      next.add(id);
                    } else {
                      next.delete(id);
                    }
                    setSelectedFetched(next);
                  }}
                  className={CHECKBOX}
                  data-testid={`fetched-model-${id}`}
                />
                <span className="font-mono text-xs">{id}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const CHECKBOX =
  "size-4 rounded border-ink-300 text-accent-500 focus:ring-2 focus:ring-accent-500 dark:border-ink-700 dark:focus:ring-accent-400";

const CHIP =
  "relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700 ring-1 ring-ink-200 transition-colors duration-150 ease-ui select-none hover:bg-ink-200/70 has-checked:bg-accent-500/18 has-checked:text-ink-900 has-checked:ring-accent-500/40 has-focus-visible:ring-2 has-focus-visible:ring-accent-500 dark:bg-ink-800 dark:text-ink-200 dark:ring-ink-700 dark:hover:bg-ink-700 dark:has-checked:bg-accent-500/20 dark:has-checked:text-ink-50";

const CHIP_INPUT = "absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-full opacity-0";

const LEGEND = "text-micro font-medium tracking-wide text-ink-500 uppercase dark:text-ink-400";
const NATIVE_KEY = "font-mono text-micro text-ink-400 normal-case dark:text-ink-500";

interface ModelCardProps {
  row: ModelRow;
  onPatch: (patch: (row: ModelRow) => ModelRow) => void;
  onRemove: () => void;
}

function ModelCard({ row, onPatch, onRemove }: ModelCardProps) {
  const { t } = useTranslation();
  const { model, invalid } = row;
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const modelLabel = model.id.trim() === "" ? t("provider.newModel") : model.id;
  const scoped = (field: string): string => t("provider.scopedLabel", { field, model: modelLabel });
  const efforts = effortsOf(model.thinking);
  const inputs = model.input ?? [];
  const nonEffortMode =
    model.thinking !== undefined && model.thinking.mode !== "effort" ? model.thinking.mode : null;

  function setModel(next: ProviderModel, clear: string[] = []): void {
    onPatch((current) => {
      const nextInvalid = { ...current.invalid };
      for (const key of clear) delete nextInvalid[key];
      return { ...current, model: next, invalid: nextInvalid };
    });
  }

  function markInvalid(key: string, raw: string): void {
    onPatch((current) => ({ ...current, invalid: { ...current.invalid, [key]: raw } }));
  }

  function commitCount(key: CountKey, raw: string): void {
    const parsed = parseCount(raw);
    if (parsed === null) {
      markInvalid(key, raw);
      return;
    }
    setModel(withKey(model, key, parsed), [key]);
  }

  function toggleEffort(effort: Effort, checked: boolean): void {
    const next = checked ? [...efforts, effort] : efforts.filter((item) => item !== effort);
    setModel(applyEfforts(model, next));
  }

  function setDefaultLevel(value: string): void {
    if (model.thinking === undefined) return;
    const level = EFFORTS.find((effort) => effort === value);
    const next: ModelThinking = { ...model.thinking };
    if (level === undefined) {
      delete next.defaultLevel;
    } else {
      next.defaultLevel = level;
    }
    setModel(withKey(model, "thinking", next));
  }

  function toggleInput(input: ModelInput, checked: boolean): void {
    const next = MODEL_INPUTS.filter((item) => (item === input ? checked : inputs.includes(item)));
    setModel(withKey(model, "input", next.length === 0 ? undefined : next));
  }

  function commitExtra(key: string, raw: string): void {
    const parsed = parseExtraValue(raw);
    if (!parsed.ok) {
      markInvalid(`extra:${key}`, raw);
      return;
    }
    setModel(withKey(model, key, parsed.value), [`extra:${key}`]);
  }

  function removeExtra(key: string): void {
    setModel(withKey(model, key, undefined), [`extra:${key}`]);
  }

  function addExtra(): void {
    const key = newKey.trim();
    if (key === "") {
      setAddError(t("provider.customKeyRequired"));
      return;
    }
    if (MANAGED_MODEL_KEYS.includes(key)) {
      setAddError(t("provider.customKeyManaged", { key }));
      return;
    }
    if (key in model) {
      setAddError(t("provider.customKeyDuplicate", { key }));
      return;
    }
    const parsed = parseExtraValue(newValue);
    if (!parsed.ok) {
      setAddError(t("provider.customValueInvalid"));
      return;
    }
    setModel(withKey(model, key, parsed.value));
    setNewKey("");
    setNewValue("");
    setAddError(null);
  }

  const countError = (key: CountKey): string | undefined =>
    invalid[key] !== undefined ? t("provider.countInvalid") : undefined;
  const countValue = (key: CountKey): string => invalid[key] ?? (model[key] === undefined ? "" : String(model[key]));

  return (
    <li
      data-testid="model-row"
      className="rounded-panel flex flex-col gap-3 bg-ink-50 p-3 ring-1 ring-ink-200 dark:bg-ink-900 dark:ring-ink-800"
    >
      <div className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field label={t("provider.modelId")} hint="id">
          {(field) => (
            <ImeSafeInput
              {...field}
              aria-label={scoped(t("provider.modelId"))}
              value={model.id}
              onCommit={(value) => setModel({ ...model, id: value })}
              className="font-mono text-xs"
              data-testid="model-id-input"
            />
          )}
        </Field>
        <Field label={t("provider.displayName")} hint="name">
          {(field) => (
            <ImeSafeInput
              {...field}
              aria-label={scoped(t("provider.displayName"))}
              value={model.name ?? ""}
              onCommit={(value) => setModel(withKey(model, "name", value === "" ? undefined : value))}
              data-testid="model-name-input"
            />
          )}
        </Field>
        <Button size="sm" variant="danger" onClick={onRemove} className="sm:mt-5" data-testid="model-remove">
          {t("common.remove")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["contextWindow", "maxTokens"] as const).map((key) => (
          <Field
            key={key}
            label={t(key === "contextWindow" ? "provider.contextWindow" : "provider.maxTokens")}
            hint={key}
            error={countError(key)}
          >
            {(field) => (
              <ImeSafeInput
                {...field}
                aria-label={scoped(t(key === "contextWindow" ? "provider.contextWindow" : "provider.maxTokens"))}
                aria-invalid={invalid[key] !== undefined}
                inputMode="numeric"
                placeholder={key === "contextWindow" ? "1000000" : "32000"}
                value={countValue(key)}
                onCommit={(value) => commitCount(key, value)}
                className="font-mono text-xs tabular-nums"
                data-testid={key === "contextWindow" ? "model-context-input" : "model-max-tokens-input"}
              />
            )}
          </Field>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className={LEGEND}>{t("provider.reasoning")}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={model.reasoning === true}
              aria-label={scoped(t("provider.reasoning"))}
              data-testid="model-reasoning"
              onClick={() => setModel({ ...model, reasoning: model.reasoning !== true })}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 ease-ui focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:focus-visible:ring-accent-400 ${
                model.reasoning === true ? "bg-accent-500" : "bg-ink-300 dark:bg-ink-700"
              }`}
            >
              <span
                className={`inline-block size-4 rounded-full bg-ink-50 shadow-sm transition-transform duration-150 ease-ui ${
                  model.reasoning === true ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
              />
            </button>
            <span className={NATIVE_KEY}>reasoning</span>
          </div>
        </div>

        <fieldset
          className="flex flex-col gap-1"
          aria-label={scoped(t("provider.inputModalities"))}
          data-testid="model-inputs"
        >
          <legend className={LEGEND}>{t("provider.inputModalities")}</legend>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {MODEL_INPUTS.map((input) => (
              <label key={input} className={CHIP}>
                <input
                  type="checkbox"
                  checked={inputs.includes(input)}
                  onChange={(e) => toggleInput(input, e.target.checked)}
                  className={CHIP_INPUT}
                  data-testid={`model-input-${input}`}
                />
                <span>{t(input === "text" ? "provider.inputText" : "provider.inputImage")}</span>
              </label>
            ))}
            <span className={NATIVE_KEY}>input</span>
          </div>
        </fieldset>
      </div>

      <fieldset
        className="flex flex-col gap-1"
        aria-label={scoped(t("provider.efforts"))}
        data-testid="model-efforts"
      >
        <legend className={LEGEND}>{t("provider.efforts")}</legend>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {EFFORTS.map((effort) => (
            <label key={effort} className={CHIP}>
              <input
                type="checkbox"
                checked={efforts.includes(effort)}
                onChange={(e) => toggleEffort(effort, e.target.checked)}
                className={CHIP_INPUT}
                data-testid={`model-effort-${effort}`}
              />
              <span>{t(`reasoning.${effort}`)}</span>
            </label>
          ))}
          <span className={NATIVE_KEY}>thinking.efforts</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-ink-600 dark:text-ink-300">
            <span>{t("provider.defaultEffort")}</span>
            <Select
              aria-label={scoped(t("provider.defaultEffort"))}
              value={model.thinking?.defaultLevel ?? ""}
              onChange={(e) => setDefaultLevel(e.target.value)}
              disabled={efforts.length === 0}
              className="w-auto py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400"
              data-testid="model-default-effort"
            >
              <option value="">{t("reasoning.unset")}</option>
              {efforts.map((effort) => (
                <option key={effort} value={effort}>
                  {t(`reasoning.${effort}`)}
                </option>
              ))}
            </Select>
          </label>
          <span className={NATIVE_KEY}>thinking.defaultLevel</span>
          {nonEffortMode !== null ? (
            <Badge tone="neutral" data-testid="model-thinking-mode">
              {t("provider.thinkingMode", { mode: nonEffortMode })}
            </Badge>
          ) : null}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 border-t border-ink-200 pt-3 dark:border-ink-800" data-testid="model-custom">
        <div className="flex items-baseline justify-between gap-2">
          <span className={LEGEND}>{t("provider.customFields")}</span>
          <span className="text-micro text-ink-400 dark:text-ink-500">{t("provider.customFieldsHint")}</span>
        </div>
        {extrasOf(model).map(([key, value]) => {
          const errorKey = `extra:${key}`;
          const raw = invalid[errorKey];
          return (
            <div key={key} className="flex flex-col gap-1" data-testid={`model-extra-${key}`}>
              <div className="grid items-center gap-2 sm:grid-cols-[10rem_1fr_auto]">
                <span className="truncate font-mono text-xs text-ink-700 dark:text-ink-200" title={key}>
                  {key}
                </span>
                <ImeSafeInput
                  aria-label={scoped(key)}
                  aria-invalid={raw !== undefined}
                  value={raw ?? JSON.stringify(value) ?? ""}
                  onCommit={(next) => commitExtra(key, next)}
                  className="font-mono text-xs"
                  data-testid="model-extra-value"
                />
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={scoped(t("provider.removeCustomField", { key }))}
                  onClick={() => removeExtra(key)}
                  data-testid="model-extra-remove"
                >
                  {t("common.remove")}
                </Button>
              </div>
              {raw !== undefined ? (
                <p role="alert" className="text-micro text-bad-500">
                  {t("provider.customValueInvalid")}
                </p>
              ) : null}
            </div>
          );
        })}
        <div className="grid items-center gap-2 sm:grid-cols-[10rem_1fr_auto]">
          <ImeSafeInput
            aria-label={scoped(t("provider.customKey"))}
            placeholder={t("provider.customKey")}
            value={newKey}
            onCommit={setNewKey}
            className="font-mono text-xs"
            data-testid="model-extra-new-key"
          />
          <ImeSafeInput
            aria-label={scoped(t("provider.customValue"))}
            placeholder={t("provider.customValuePlaceholder")}
            value={newValue}
            onCommit={setNewValue}
            className="font-mono text-xs"
            data-testid="model-extra-new-value"
          />
          <Button size="sm" onClick={addExtra} data-testid="model-extra-add">
            {t("provider.addCustomField")}
          </Button>
        </div>
        {addError !== null ? (
          <p role="alert" className="text-micro text-bad-500">
            {addError}
          </p>
        ) : null}
      </div>
    </li>
  );
}

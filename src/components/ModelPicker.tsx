import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { mergeModelOptions } from "../lib/deadReference";
import type { ModelInfo, ProviderInfo } from "../lib/types";
import { ImeSafeInput } from "./ImeSafeInput";
import { Badge, Button } from "./primitives";

export const MODEL_PICKER_LIMIT = 200;

export interface ModelPickerProps {
  id: string;
  value: string;
  models: readonly ModelInfo[];
  providers: readonly ProviderInfo[];
  omoAvailable: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  onRefresh: () => Promise<void>;
  onPick?: (value: string) => void;
  trailing?: ReactNode;
}

export function ModelPicker({
  id,
  value,
  models,
  providers,
  omoAvailable,
  describedBy,
  onChange,
  onRefresh,
  onPick,
  trailing,
}: ModelPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // Only what the user typed since the list opened; opening always starts unfiltered.
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  // Bumped after a pick so ImeSafeInput remounts with the picked value instead of a stale draft.
  const [revision, setRevision] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const pickingRef = useRef(false);
  const suppressOpenRef = useRef(false);
  // In add mode Enter submits the typed text unless the user arrowed onto a suggestion.
  const navigatedRef = useRef(false);

  const options = useMemo(() => mergeModelOptions(models, providers), [models, providers]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return options;
    return options.filter((option) => option.id.toLowerCase().includes(needle));
  }, [options, query]);

  const matches = useMemo(() => filtered.slice(0, MODEL_PICKER_LIMIT), [filtered]);

  useEffect(() => {
    if (revision === 0) return;
    pickingRef.current = false;
    inputRef.current?.focus();
  }, [revision]);

  const activeId = open && matches[highlight] !== undefined ? `${listId}-opt-${highlight}` : undefined;

  useEffect(() => {
    if (activeId === undefined) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const hint = omoAvailable ? t("modelPicker.freeTextHint") : t("modelPicker.omoMissingHint");
  const hintId = `${listId}-hint`;

  function openList(): void {
    navigatedRef.current = false;
    setQuery("");
    const selected = options.slice(0, MODEL_PICKER_LIMIT).findIndex((option) => option.id === value);
    setHighlight(selected === -1 ? 0 : selected);
    setOpen(true);
  }

  function push(next: string): void {
    if (pickingRef.current || next === value) return;
    onChange(next);
  }

  function pick(next: string): void {
    if (onPick !== undefined) onPick(next);
    else onChange(next);
    pickingRef.current = true;
    suppressOpenRef.current = true;
    setQuery("");
    setOpen(false);
    setRevision((current) => current + 1);
  }

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <ImeSafeInput
            key={revision}
            ref={inputRef}
            id={id}
            role="combobox"
            autoComplete="off"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-describedby={[describedBy, hintId].filter((entry) => entry !== undefined).join(" ")}
            value={value}
            placeholder={t("editor.fallbackPlaceholder")}
            className="font-mono"
            onCommit={push}
            onInput={(event) => {
              const next = event.currentTarget.value;
              navigatedRef.current = false;
              setQuery(next);
              setHighlight(0);
              setOpen(true);
              if (!composingRef.current) push(next);
            }}
            onCompositionStartCapture={() => {
              composingRef.current = true;
            }}
            onCompositionEndCapture={(event) => {
              composingRef.current = false;
              push(event.currentTarget.value);
            }}
            onFocusCapture={() => {
              if (suppressOpenRef.current) {
                suppressOpenRef.current = false;
                return;
              }
              openList();
            }}
            onBlur={() => setOpen(false)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || composingRef.current) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (!open) {
                  openList();
                  return;
                }
                navigatedRef.current = true;
                setHighlight((current) => (matches.length === 0 ? 0 : (current + 1) % matches.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                navigatedRef.current = true;
                setHighlight((current) =>
                  matches.length === 0 ? 0 : (current - 1 + matches.length) % matches.length,
                );
              } else if (event.key === "Enter" && onPick !== undefined) {
                event.preventDefault();
                const typed = event.currentTarget.value.trim();
                const highlighted = open ? matches[highlight] : undefined;
                const next =
                  highlighted !== undefined && (navigatedRef.current || typed === "")
                    ? highlighted.id
                    : typed;
                if (next !== "") pick(next);
              } else if (event.key === "Enter" && open) {
                const picked = matches[highlight];
                if (picked !== undefined) {
                  event.preventDefault();
                  pick(picked.id);
                }
              } else if (event.key === "Escape" && open) {
                event.stopPropagation();
                setOpen(false);
              }
            }}
          />
          {open ? (
            <div
              onMouseDown={(event) => event.preventDefault()}
              className="rounded-panel absolute z-30 mt-1 w-full overflow-hidden bg-ink-50 shadow-xl ring-1 ring-ink-300 dark:bg-ink-800 dark:ring-ink-700"
            >
              <ul
                id={listId}
                role="listbox"
                aria-label={t("modelPicker.title")}
                className="max-h-64 overflow-y-auto py-1"
              >
                {matches.length === 0 ? (
                  <li className="px-2.5 py-1.5 text-micro text-ink-500 dark:text-ink-400">
                    {t("modelPicker.empty")}
                  </li>
                ) : (
                  matches.map((option, index) => (
                    <li
                      key={`${option.source}:${option.id}`}
                      id={`${listId}-opt-${index}`}
                      role="option"
                      aria-selected={option.id === value}
                      data-source={option.source}
                      onMouseEnter={() => setHighlight(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pick(option.id);
                      }}
                      className={`flex cursor-pointer items-center justify-between gap-3 px-2.5 py-1.5 font-mono text-sm ${
                        index === highlight
                          ? "bg-ink-200/80 text-ink-900 dark:bg-ink-700 dark:text-ink-50"
                          : option.id === value
                            ? "bg-ink-200/40 text-ink-900 dark:bg-ink-700/50 dark:text-ink-50"
                            : "text-ink-700 dark:text-ink-200"
                      }`}
                    >
                      <span className="min-w-0 truncate">{option.id}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {option.context !== null ? (
                          <span className="text-micro text-ink-500 dark:text-ink-400">{option.context}</span>
                        ) : null}
                        <Badge tone={option.source === "configured" ? "accent" : "neutral"}>
                          {option.source === "configured"
                            ? t("provider.sourceConfigured")
                            : t("provider.sourceOmo")}
                        </Badge>
                      </span>
                    </li>
                  ))
                )}
              </ul>
              <p
                data-testid="model-picker-count"
                className="border-t border-ink-200 px-2.5 py-1 text-micro text-ink-500 tabular-nums dark:border-ink-700 dark:text-ink-400"
              >
                {filtered.length > matches.length
                  ? t("modelPicker.truncated", { total: filtered.length, shown: matches.length })
                  : t("modelPicker.count", { count: filtered.length, total: options.length })}
              </p>
            </div>
          ) : null}
        </div>
        {trailing ?? (
          <Button
            disabled={refreshing}
            aria-busy={refreshing}
            aria-label={refreshing ? t("modelPicker.refreshing") : t("modelPicker.refresh")}
            title={t("modelPicker.refresh")}
            size="icon"
            onClick={() => void refresh()}
          >
            <span aria-hidden="true" className={refreshing ? "animate-spin" : ""}>
              ↻
            </span>
          </Button>
        )}
      </div>
      <p
        id={hintId}
        className={
          !omoAvailable && onPick === undefined
            ? "text-micro text-warn-700 dark:text-warn-300"
            : open
              ? "text-micro text-ink-500 dark:text-ink-400"
              : "sr-only"
        }
      >
        {hint}
      </p>
    </div>
  );
}

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { mergeModelOptions } from "../lib/deadReference";
import type { ModelInfo, ProviderInfo } from "../lib/types";
import { ImeSafeInput } from "./ImeSafeInput";
import { Badge, Button } from "./primitives";

export interface ModelPickerProps {
  id: string;
  value: string;
  models: readonly ModelInfo[];
  providers: readonly ProviderInfo[];
  omoAvailable: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
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
}: ModelPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // What the user is typing; filters the list without waiting for an IME commit.
  const [query, setQuery] = useState(value);
  // Bumped after a pick so ImeSafeInput remounts with the picked value instead of a stale draft.
  const [revision, setRevision] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const pickingRef = useRef(false);
  const suppressOpenRef = useRef(false);

  const options = useMemo(() => mergeModelOptions(models, providers), [models, providers]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return options.slice(0, 40);
    return options.filter((option) => option.id.toLowerCase().includes(needle)).slice(0, 40);
  }, [options, query]);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setQuery(value);
  }, [value]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (revision === 0) return;
    pickingRef.current = false;
    inputRef.current?.focus();
  }, [revision]);

  const hint = omoAvailable ? t("modelPicker.freeTextHint") : t("modelPicker.omoMissingHint");
  const hintId = `${listId}-hint`;
  const activeId = open && matches[highlight] !== undefined ? `${listId}-opt-${highlight}` : undefined;

  function push(next: string): void {
    if (pickingRef.current || next === value) return;
    onChange(next);
  }

  function pick(next: string): void {
    onChange(next);
    pickingRef.current = true;
    suppressOpenRef.current = true;
    setQuery(next);
    setOpen(false);
    setRevision((current) => current + 1);
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
            className="font-mono text-xs"
            onCommit={push}
            onInput={(event) => {
              const next = event.currentTarget.value;
              setQuery(next);
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
              setOpen(true);
            }}
            onBlur={() => setOpen(false)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || composingRef.current) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setHighlight((current) => (matches.length === 0 ? 0 : (current + 1) % matches.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((current) =>
                  matches.length === 0 ? 0 : (current - 1 + matches.length) % matches.length,
                );
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
            <ul
              id={listId}
              role="listbox"
              aria-label={t("modelPicker.title")}
              onMouseDown={(event) => event.preventDefault()}
              className="rounded-panel absolute z-30 mt-1 max-h-64 w-full overflow-y-auto bg-ink-50 py-1 shadow-xl ring-1 ring-ink-300 dark:bg-ink-800 dark:ring-ink-700"
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
                    className={`flex cursor-pointer items-center justify-between gap-3 px-2.5 py-1.5 font-mono text-xs ${
                      index === highlight
                        ? "bg-ink-200/80 text-ink-900 dark:bg-ink-700 dark:text-ink-50"
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
          ) : null}
        </div>
        <Button size="sm" onClick={onRefresh}>
          {t("modelPicker.refresh")}
        </Button>
      </div>
      <p
        id={hintId}
        className={`text-micro ${omoAvailable ? "text-ink-500 dark:text-ink-400" : "text-warn-500"}`}
      >
        {hint}
      </p>
    </div>
  );
}

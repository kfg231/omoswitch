import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "../lib/types";
import { Button } from "./primitives";

export interface ModelPickerProps {
  id: string;
  value: string;
  models: readonly ModelInfo[];
  omoAvailable: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
}

export function ModelPicker({
  id,
  value,
  models,
  omoAvailable,
  describedBy,
  onChange,
  onRefresh,
}: ModelPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const needle = value.trim().toLowerCase();
    if (needle === "") return models.slice(0, 40);
    return models.filter((model) => model.id.toLowerCase().includes(needle)).slice(0, 40);
  }, [models, value]);

  useEffect(() => {
    setHighlight(0);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      const wrapper = wrapperRef.current;
      if (wrapper !== null && event.target instanceof Node && !wrapper.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const hint = omoAvailable ? t("modelPicker.freeTextHint") : t("modelPicker.omoMissingHint");
  const hintId = `${listId}-hint`;
  const activeId = open && matches[highlight] !== undefined ? `${listId}-opt-${highlight}` : undefined;

  function commit(next: string): void {
    onChange(next);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <input
            id={id}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-describedby={[describedBy, hintId].filter((entry) => entry !== undefined).join(" ")}
            value={value}
            placeholder={t("editor.fallbackPlaceholder")}
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
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
                  commit(picked.id);
                }
              } else if (event.key === "Escape" && open) {
                event.stopPropagation();
                setOpen(false);
              }
            }}
            className="w-full rounded-md bg-ink-50 px-2.5 py-1.5 font-mono text-xs text-ink-800 ring-1 ring-ink-200 transition-colors duration-150 ease-ui placeholder:text-ink-400 hover:ring-ink-300 dark:bg-ink-900 dark:text-ink-100 dark:ring-ink-700 dark:placeholder:text-ink-500 dark:hover:ring-ink-600"
          />
          {open ? (
            <ul
              id={listId}
              role="listbox"
              aria-label={t("modelPicker.title")}
              className="rounded-panel absolute z-30 mt-1 max-h-64 w-full overflow-y-auto bg-ink-50 py-1 shadow-xl ring-1 ring-ink-300 dark:bg-ink-800 dark:ring-ink-700"
            >
              {matches.length === 0 ? (
                <li className="px-2.5 py-1.5 text-micro text-ink-500 dark:text-ink-400">
                  {t("modelPicker.empty")}
                </li>
              ) : (
                matches.map((model, index) => (
                  <li
                    key={model.id}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={model.id === value}
                    onMouseEnter={() => setHighlight(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      commit(model.id);
                    }}
                    className={`flex cursor-pointer items-baseline justify-between gap-3 px-2.5 py-1.5 font-mono text-xs ${
                      index === highlight
                        ? "bg-ink-200/80 text-ink-900 dark:bg-ink-700 dark:text-ink-50"
                        : "text-ink-700 dark:text-ink-200"
                    }`}
                  >
                    <span>{model.id}</span>
                    <span className="text-micro text-ink-500 dark:text-ink-400">{model.context}</span>
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

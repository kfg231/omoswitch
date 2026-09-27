import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "./primitives";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}

export function Dialog({ title, onClose, footer, wide = false, children }: DialogProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    if (panel !== null) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (panel === null) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (item) => item.offsetParent !== null || item === document.activeElement,
      );
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink-950/45 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`rounded-panel relative flex max-h-[90vh] w-full flex-col bg-ink-50 shadow-2xl ring-1 ring-ink-300 dark:bg-ink-900 dark:ring-ink-700 ${
          wide ? "max-w-3xl" : "max-w-xl"
        }`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3 dark:border-ink-800">
          <h2 id={titleId} className="text-sm font-semibold text-ink-800 dark:text-ink-100">
            {title}
          </h2>
          <IconButton label={t("common.close")} onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer !== undefined ? (
          <footer className="flex items-center justify-end gap-2 border-t border-ink-200 px-4 py-3 dark:border-ink-800">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

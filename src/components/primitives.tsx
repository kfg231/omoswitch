import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors duration-150 ease-ui disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-500 text-ink-950 hover:bg-accent-400 active:bg-accent-600 dark:text-ink-950",
  secondary:
    "bg-ink-50 text-ink-800 ring-1 ring-ink-200 hover:bg-ink-100 active:bg-ink-200 dark:bg-ink-800 dark:text-ink-100 dark:ring-ink-700 dark:hover:bg-ink-700",
  ghost:
    "bg-transparent text-ink-600 hover:bg-ink-200/70 active:bg-ink-300/70 dark:text-ink-300 dark:hover:bg-ink-800 dark:active:bg-ink-700",
  danger:
    "bg-transparent text-bad-500 hover:bg-bad-500/12 active:bg-bad-500/20",
};

const BUTTON_SIZES = {
  sm: "h-7 px-2 text-xs",
  md: "h-9 px-3 text-sm",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
}

export function Button({ variant = "secondary", size = "md", className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...rest}
    />
  );
}
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function IconButton({ label, className = "", ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS.ghost} size-7 text-sm ${className}`}
      {...rest}
    />
  );
}

const CONTROL =
  "w-full rounded-md bg-ink-50 px-2.5 py-1.5 text-sm text-ink-800 ring-1 ring-ink-200 transition-colors duration-150 ease-ui placeholder:text-ink-400 hover:ring-ink-300 disabled:opacity-60 dark:bg-ink-900 dark:text-ink-100 dark:ring-ink-700 dark:placeholder:text-ink-500 dark:hover:ring-ink-600";

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className={`${CONTROL} ${className}`} {...rest} />;
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  prose?: boolean;
}

export function TextArea({ prose = false, className = "", ...rest }: TextAreaProps) {
  const face = prose ? "font-sans text-sm" : "font-mono text-xs";
  return <textarea className={`${CONTROL} ${face} ${className}`} {...rest} />;
}

export function Select({ className = "", ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${CONTROL} ${className}`} {...rest} />;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  labelHidden?: boolean;
  children: (props: { id: string; "aria-describedby": string | undefined }) => ReactNode;
}

export function Field({ label, hint, error, labelHidden = false, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
    .filter((value): value is string => value !== null)
    .join(" ");

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className={
          labelHidden
            ? "sr-only"
            : "text-micro font-medium tracking-wide text-ink-500 uppercase dark:text-ink-400"
        }
      >
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy === "" ? undefined : describedBy })}
      {hint !== undefined ? (
        <p id={hintId} className="text-micro text-ink-500 dark:text-ink-400">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-micro text-bad-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type BadgeTone = "neutral" | "accent" | "good" | "warn" | "bad";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-ink-200/70 text-ink-700 dark:bg-ink-800 dark:text-ink-200",
  accent: "bg-accent-500/18 text-accent-600 dark:text-accent-400",
  good: "bg-good-500/18 text-good-500",
  warn: "bg-warn-500/20 text-warn-500",
  bad: "bg-bad-500/15 text-bad-500",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children: ReactNode;
}

export function Badge({ tone = "neutral", className = "", children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={`rounded-panel bg-ink-50 ring-1 ring-ink-200 dark:bg-ink-900 dark:ring-ink-800 ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-micro font-semibold tracking-widest text-ink-500 uppercase dark:text-ink-400">
      {children}
    </h2>
  );
}

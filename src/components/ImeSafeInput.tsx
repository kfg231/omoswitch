import type { InputHTMLAttributes } from "react";
import { forwardRef, useEffect, useRef, useState } from "react";

const CONTROL =
  "w-full rounded-md bg-ink-50 px-2.5 py-1.5 text-sm text-ink-800 ring-1 ring-ink-200 transition-colors duration-150 ease-ui placeholder:text-ink-400 hover:ring-ink-300 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60 dark:bg-ink-900 dark:text-ink-100 dark:ring-ink-700 dark:placeholder:text-ink-500 dark:hover:ring-ink-600 dark:focus:ring-accent-400";

interface ImeSafeInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue"> {
  value: string;
  onCommit: (value: string) => void;
}

export const ImeSafeInput = forwardRef<HTMLInputElement, ImeSafeInputProps>(
  ({ value, onCommit, className = "", onBlur, onKeyDown, ...rest }, ref) => {
    const [draft, setDraft] = useState(value);
    const [isFocused, setIsFocused] = useState(false);
    const isComposingRef = useRef(false);

    useEffect(() => {
      if (!isFocused) {
        setDraft(value);
      }
    }, [value, isFocused]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraft(e.target.value);
    };

    const handleCommit = () => {
      if (draft !== value) {
        onCommit(draft);
      }
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      handleCommit();
      onBlur?.(e);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.nativeEvent.isComposing && !isComposingRef.current) {
        handleCommit();
      }
      onKeyDown?.(e);
    };

    const handleCompositionStart = () => {
      isComposingRef.current = true;
    };

    const handleCompositionEnd = () => {
      isComposingRef.current = false;
    };

    const handleFocus = () => {
      setIsFocused(true);
    };

    return (
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        className={`${CONTROL} ${className}`}
        {...rest}
      />
    );
  }
);

ImeSafeInput.displayName = "ImeSafeInput";

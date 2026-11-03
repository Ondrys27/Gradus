"use client";

import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/** The text shown, replaced when the saved value changes from outside. */
export function useSyncedText(value: string): [string, (next: string) => void] {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  return [text, setText];
}

/**
 * Enter saves (by leaving the field). Esc with a change puts back what was
 * there and keeps the window open; Esc without one closes the window.
 */
export function editKeys(dirty: boolean, onRevert: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape" && dirty) {
      event.stopPropagation();
      onRevert();
    }
  };
}

export const fieldClass =
  "-mx-2 w-[calc(100%+16px)] rounded-xl border border-transparent bg-transparent px-2 py-1 text-ink outline-none placeholder:text-ink-muted hover:border-line focus-visible:border-violet focus-visible:ring-3 focus-visible:ring-violet/25";

/**
 * One line of text edited in place: it looks like text until hovered or
 * focused and saves when left. `required` puts back the old value when emptied.
 */
export function EditableText({
  id,
  value,
  label,
  placeholder,
  maxLength,
  required,
  type = "text",
  className,
  testId,
  onSave,
}: {
  id: string;
  value: string | null;
  label: string;
  placeholder?: string;
  maxLength: number;
  required?: boolean;
  type?: "text" | "email";
  className?: string;
  testId?: string;
  onSave: (value: string | null) => void;
}) {
  const saved = value ?? "";
  const [text, setText] = useSyncedText(saved);
  function commit() {
    const clean = text.trim();
    if ((required && !clean) || clean.length > maxLength) {
      setText(saved);
      return;
    }
    if (clean !== saved) onSave(clean || null);
  }
  return (
    <input
      id={id}
      data-testid={testId}
      type={type}
      value={text}
      aria-label={label}
      placeholder={placeholder}
      maxLength={maxLength + 10}
      autoComplete="off"
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={editKeys(text !== saved, () => setText(saved))}
      className={cn(fieldClass, className)}
    />
  );
}

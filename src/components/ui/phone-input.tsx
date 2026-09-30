"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ComponentProps,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import {
  callingCodePrefix,
  caretAfterSignificant,
  cleanPhoneInput,
  formatAsYouType,
  formatPhoneForInput,
  isPhoneSignificant,
  isValidPhone,
  significantBefore,
  toE164,
} from "@/lib/phone";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<"input">, "value" | "onChange" | "type" | "defaultValue"> & {
  id: string;
  /** Saved value: E.164, legacy text that could not be read, or "". */
  value: string;
  /** Receives E.164 when the number can be read, the text otherwise, "" when empty. */
  onChange: (value: string) => void;
  /** The user's country (`user_settings.country_code`): default prefix and national grouping. */
  country: string | null | undefined;
};

/**
 * The only field for phone numbers. Groups the digits while typing without
 * moving the caret, re-reads a pasted number in any form, starts with the
 * user's country prefix and saves E.164. An invalid number gets a soft note
 * under the field; saving is never blocked.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  country,
  className,
  onFocus,
  onBlur,
  "aria-describedby": describedBy,
  ...props
}: Props) {
  const t = useTranslations("phone");
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [text, setText] = useState(() => formatPhoneForInput(value, country));
  const [synced, setSynced] = useState(value);
  const [focused, setFocused] = useState(false);

  // A value set from outside (a reset, another record) replaces what is shown.
  if (value !== synced) {
    setSynced(value);
    setText(formatPhoneForInput(value, country));
  }

  useLayoutEffect(() => {
    const input = inputRef.current;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    if (input && caret !== null && document.activeElement === input) {
      input.setSelectionRange(caret, caret);
    }
  });

  /** Formats `next` and puts the caret after `significant` digits of it. */
  function apply(next: string, significant: number) {
    const formatted = formatAsYouType(next, country);
    setText(formatted);
    pendingCaret.current = caretAfterSignificant(formatted, significant);
    const saved = toE164(formatted, country) ?? "";
    if (saved !== value) {
      setSynced(saved);
      onChange(saved);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    props.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    if (start === null || start !== end) return;
    // Deleting a space or a bracket removes the digit next to it instead.
    const step = event.key === "Backspace" ? -1 : 1;
    let index = event.key === "Backspace" ? start - 1 : start;
    if (index < 0 || index >= text.length || isPhoneSignificant(text[index])) return;
    while (index >= 0 && index < text.length && !isPhoneSignificant(text[index])) index += step;
    event.preventDefault();
    if (index < 0 || index >= text.length) return;
    apply(text.slice(0, index) + text.slice(index + 1), significantBefore(text, index));
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    props.onPaste?.(event);
    if (event.defaultPrevented) return;
    const pasted = cleanPhoneInput(event.clipboardData.getData("text"));
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    const everything = start === 0 && end === text.length;
    const onlyPrefix = toE164(text, country) === null;
    // A whole number replaces the field; a national one keeps the prefix typed so far.
    if (!pasted.startsWith("+") && !everything && !onlyPrefix) return;
    event.preventDefault();
    const next =
      pasted.startsWith("+") || everything || !pasted
        ? pasted
        : `${cleanPhoneInput(text)}${pasted}`;
    apply(next, cleanPhoneInput(next).length);
  }

  const warningId = `${id}-phone-warning`;
  const showWarning =
    !focused && text !== "" && toE164(text, country) !== null && !isValidPhone(text, country);

  return (
    <div className="flex flex-col gap-1.5">
      <input
        {...props}
        ref={inputRef}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={props.autoComplete ?? "tel"}
        data-slot="input"
        className={cn("field tabular-nums", className)}
        value={text}
        aria-describedby={
          [describedBy, showWarning ? warningId : null].filter(Boolean).join(" ") || undefined
        }
        onChange={(event) => {
          const raw = event.target.value;
          const caret = event.target.selectionStart ?? raw.length;
          apply(raw, cleanPhoneInput(raw.slice(0, caret)).length);
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={(event) => {
          setFocused(true);
          if (text === "") {
            const prefix = `${callingCodePrefix(country)} `;
            setText(prefix);
            pendingCaret.current = prefix.length;
          }
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          // A prefix alone is not a number.
          if (toE164(text, country) === null) setText("");
          onBlur?.(event);
        }}
      />
      {showWarning && (
        <p id={warningId} className="text-xs text-gold" aria-live="polite">
          {t("invalid")}
        </p>
      )}
    </div>
  );
}

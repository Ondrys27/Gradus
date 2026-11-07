"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { CheckIcon } from "lucide-react";
import { useTypewriter } from "@/components/jarvis/speech-bubble";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { emphasize, plainText, sliceParts, type TextPart } from "./presentation";

/**
 * What Jarvis says in a step: the verb of the action stands out (`**verb**`
 * in the translation), the line is typed out when asked for (reduced motion
 * shows it at once; screen readers always get the whole sentence).
 */
export function StepText({
  text,
  typed = false,
  className,
}: {
  text: string;
  typed?: boolean;
  className?: string;
}) {
  const parts = useMemo(() => emphasize(text), [text]);
  const plain = useMemo(() => plainText(text), [text]);
  const typing = useTypewriter(typed ? plain : "");
  const shown: TextPart[] = typed && !typing.done ? sliceParts(parts, typing.shown.length) : parts;
  return (
    <p className={cn("text-[15px] leading-relaxed break-words text-ink", className)}>
      <span className="sr-only">{plain}</span>
      <span aria-hidden>
        {shown.map((part, index) =>
          part.strong ? (
            <strong key={index} className="font-semibold text-teal">
              {part.text}
            </strong>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </span>
    </p>
  );
}

/**
 * Jarvis's short reaction once a hands-on step is done: pops in with a tick,
 * then the Next button lights up. Still with reduced motion.
 */
export function Reaction({ text }: { text: string }) {
  const reduce = useReducedMotionSafe();
  return (
    <motion.p
      role="status"
      initial={reduce ? false : { opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 24 }}
      className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-green"
    >
      <motion.span
        aria-hidden
        className="grid size-5 place-items-center rounded-full bg-green/20"
        initial={reduce ? false : { scale: 0 }}
        animate={{ scale: 1 }}
        transition={
          reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 18, delay: 0.08 }
        }
      >
        <CheckIcon className="size-3.5" strokeWidth={3} />
      </motion.span>
      {text}
    </motion.p>
  );
}

import type { z } from "zod";

/**
 * Reads the JSON object a routine model call was asked to answer with. The
 * model may wrap it in a code fence or a sentence; the outermost braces are
 * taken. Null when it is missing or does not match the schema.
 */
export function parseModelJson<T extends z.ZodType>(text: string, schema: T): z.infer<T> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

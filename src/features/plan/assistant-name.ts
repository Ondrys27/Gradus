/**
 * The first published catalog version was written while the assistant was
 * still called Jarvis (26.1 renamed him to Grady). Published versions never
 * change (plan_catalog_versions_guard), so the stored card texts keep the old
 * name; everything shown from the catalog says Grady, declined in Czech
 * (Jarvise → Gradyho, Jarvisovi → Gradymu, Jarvisem → Gradym).
 */

const OLD_NAME = /\bJarvis(ovi|em|e)?\b/g;
const NEW_NAME: Record<string, string> = { "": "Grady", e: "Gradyho", ovi: "Gradymu", em: "Gradym" };

export function withAssistantName(text: string): string {
  return text.replace(OLD_NAME, (_match, suffix: string | undefined) => NEW_NAME[suffix ?? ""]!);
}

/** Every string of a stored catalog value (tariffs or add-ons) with the assistant's current name. */
export function withAssistantNames<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "string" ? withAssistantName(item) : item,
    ),
  ) as T;
}

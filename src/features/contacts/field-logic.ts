import type { Json } from "@/types/database";
import type { ContactField, FieldOption } from "./types";

export type Positioned = { id: string; position: number };
export type PositionChange = { id: string; position: number };

export function byPosition<T extends Positioned>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position);
}

export function nextPosition(items: Positioned[]): number {
  return items.length ? Math.max(...items.map((item) => item.position)) + 1 : 0;
}

/** Moves one item to the place of another; returns the new order and only the positions that change. */
export function reorder<T extends Positioned>(items: T[], activeId: string, overId: string) {
  const sorted = byPosition(items);
  const from = sorted.findIndex((item) => item.id === activeId);
  const to = sorted.findIndex((item) => item.id === overId);
  if (from < 0 || to < 0 || from === to) return { items: sorted, changes: [] as PositionChange[] };
  const next = [...sorted];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const changes: PositionChange[] = [];
  const reordered = next.map((item, index) => {
    if (item.position !== index) changes.push({ id: item.id, position: index });
    return { ...item, position: index };
  });
  return { items: reordered, changes };
}

/** Options of a select question; anything malformed is dropped. */
export function fieldOptions(options: Json | null): FieldOption[] {
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    if (!option || typeof option !== "object" || Array.isArray(option)) return [];
    const { key, label } = option as Record<string, unknown>;
    return typeof key === "string" && typeof label === "string" && key && label
      ? [{ key, label }]
      : [];
  });
}

/** A key that stays when the option is renamed, so answers and dependencies keep pointing at it. */
export function newOptionKey(existing: FieldOption[]): string {
  let key: string;
  do {
    key = `opt_${Math.random().toString(36).slice(2, 8)}`;
  } while (existing.some((option) => option.key === key));
  return key;
}

/** Questions this one may depend on: select questions of the same table, never itself or its own dependants. */
export function dependencyCandidates(
  fields: ContactField[],
  fieldId: string | null,
): ContactField[] {
  const blocked = new Set<string>();
  if (fieldId) {
    blocked.add(fieldId);
    let grew = true;
    while (grew) {
      grew = false;
      for (const field of fields) {
        if (
          field.depends_on_field_id &&
          blocked.has(field.depends_on_field_id) &&
          !blocked.has(field.id)
        ) {
          blocked.add(field.id);
          grew = true;
        }
      }
    }
  }
  return byPosition(fields).filter((field) => field.type === "select" && !blocked.has(field.id));
}

/**
 * "You now have access to Finance — shall I show you?" (30.2): the sections of
 * a worker's menu they were not introduced to yet, in menu order. What was
 * introduced (or offered) is remembered, so each section is offered once,
 * and a right taken away and given back is not offered again.
 */
export function newSections<T extends string>(known: readonly string[], current: readonly T[]): T[] {
  const seen = new Set(known);
  return current.filter((section) => !seen.has(section));
}

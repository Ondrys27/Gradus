/**
 * Whether the browser asks for English before Czech (Accept-Language). Used
 * only on the very first visit to the home page; after that the address decides.
 * Slovak counts as Czech: the Czech site reads fine for it.
 */
export function prefersEnglish(acceptLanguage: string | null | undefined): boolean {
  if (!acceptLanguage) return false;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.split("-")[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.lang && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { lang } of ranked) {
    if (lang === "cs" || lang === "sk") return false;
    if (lang === "en") return true;
  }
  // Neither language asked for: a foreign visitor understands English better.
  return ranked.length > 0;
}

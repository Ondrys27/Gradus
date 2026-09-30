/**
 * The time zone picker: zones grouped by continent, labelled with the continent
 * in the UI language ("Evropa/Prague"), searchable without diacritics.
 */

/** Continents in the order the picker lists them; keys under `settings.region.continents`. */
export const CONTINENTS = [
  "Europe",
  "America",
  "Asia",
  "Africa",
  "Australia",
  "Pacific",
  "Atlantic",
  "Indian",
  "Antarctica",
  "Arctic",
  "Other",
] as const;
export type Continent = (typeof CONTINENTS)[number];

export type ZoneGroup = { value: Continent; items: string[] };

export function zoneContinent(zone: string): Continent {
  const first = zone.split("/")[0];
  return zone.includes("/") && (CONTINENTS as readonly string[]).includes(first)
    ? (first as Continent)
    : "Other";
}

/** "Europe/Prague" → "Evropa/Prague"; "America/Argentina/Buenos_Aires" → "Amerika/Argentina/Buenos Aires". */
export function zoneLabel(zone: string, continentName: (continent: Continent) => string): string {
  const continent = zoneContinent(zone);
  const rest = continent === "Other" ? zone : zone.slice(zone.indexOf("/") + 1);
  const place = rest.replaceAll("_", " ");
  return continent === "Other" ? place : `${continentName(continent)}/${place}`;
}

/** Lower case without diacritics, underscores and slashes as spaces. */
export function searchKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether every word typed appears in the zone: in its label (continent in the
 * UI language) or its IANA id (English), so "evropa praha" and "prague" both work
 * as far as the names allow.
 */
export function zoneMatches(zone: string, label: string, query: string): boolean {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${searchKey(label)} ${searchKey(zone)}`;
  return words.every((word) => haystack.includes(word));
}

/** Zones grouped by continent in `CONTINENTS` order, each group sorted by label. */
export function groupZones(
  zones: string[],
  continentName: (continent: Continent) => string,
  uiLocale: string,
): ZoneGroup[] {
  const byContinent = new Map<Continent, string[]>();
  for (const zone of new Set(zones)) {
    const continent = zoneContinent(zone);
    byContinent.set(continent, [...(byContinent.get(continent) ?? []), zone]);
  }
  return CONTINENTS.flatMap((continent) => {
    const items = byContinent.get(continent);
    if (!items) return [];
    const sorted = [...items].sort((a, b) =>
      zoneLabel(a, continentName).localeCompare(zoneLabel(b, continentName), uiLocale),
    );
    return [{ value: continent, items: sorted }];
  });
}

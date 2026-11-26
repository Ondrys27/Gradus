import {
  GRANT_SECTIONS,
  PERMISSION_CATALOG,
  SCOPE_ACTION,
  actionsOf,
  grantAllows,
  seesSection,
  type GrantSection,
  type PermissionGrants,
} from "./permissions-catalog";

/**
 * What a person will have access to in a company, in plain words (30.2): the
 * invite card in the app and the invite e-mail say it the same way. Section
 * by section in the order of the menu: what they see, all or only their own,
 * and what they may do there; then what stays closed. Pure, so both the
 * browser and the server render it from the stored grants.
 */

export type AccessLine = {
  section: GrantSection;
  /** "All / only their own" of sections that have it; null elsewhere. */
  scope: "all" | "own" | null;
  /** The allowed actions besides seeing the section and its scope, in catalog order. */
  actions: string[];
};

export type AccessSummary = { lines: AccessLine[]; hidden: GrantSection[] };

/**
 * Connected apps say something only when the person may connect one; the
 * section itself is on by default and means nothing on its own.
 */
function worthSaying(line: AccessLine): boolean {
  return line.section !== "integrations" || line.actions.length > 0;
}

export function accessSummary(grants: PermissionGrants): AccessSummary {
  const lines: AccessLine[] = [];
  const hidden: GrantSection[] = [];
  for (const section of GRANT_SECTIONS) {
    if (!seesSection(grants, section)) {
      if (section !== "integrations") hidden.push(section);
      continue;
    }
    const all = actionsOf(section);
    const scoped = (all as string[]).includes(SCOPE_ACTION);
    const line: AccessLine = {
      section,
      scope: scoped ? (grantAllows(grants, section, SCOPE_ACTION) ? "all" : "own") : null,
      actions: all.filter(
        (action) => action !== "view" && action !== SCOPE_ACTION && grantAllows(grants, section, action),
      ),
    };
    if (worthSaying(line)) lines.push(line);
  }
  return { lines, hidden };
}

/** Translates a key under `workers.access`. */
export type AccessTranslator = (key: string, values?: Record<string, string>) => string;

/** The nav key of a section's name (`nav.*`); invoices are named under the access texts. */
export function sectionNavKey(section: GrantSection): string {
  return PERMISSION_CATALOG.find((entry) => entry.key === section)?.nav ?? section;
}

/**
 * The summary as sentences: "Pipeline: only yours, see amounts, change the
 * stage", then "You won't see: Finance, Invoices." and what is always theirs.
 * `sectionName` names a section (from `nav.*` in the caller's language).
 */
export function accessSentences(
  grants: PermissionGrants,
  t: AccessTranslator,
  sectionName: (section: GrantSection) => string,
): { lines: string[]; hidden: string | null; always: string } {
  const summary = accessSummary(grants);
  const lines = summary.lines.map((line) => {
    const parts = [
      ...(line.scope ? [t(`scope.${line.section === "company" ? "company" : "records"}.${line.scope}`)] : []),
      ...line.actions.map((action) => t(`actions.${line.section}.${action}`)),
    ];
    return t("line", {
      section: sectionName(line.section),
      what: parts.length ? parts.join(", ") : t("viewOnly"),
    });
  });
  const hidden = summary.hidden.length
    ? t("hidden", { sections: summary.hidden.map(sectionName).join(", ") })
    : null;
  return { lines, hidden, always: t("always") };
}

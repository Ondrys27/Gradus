"use client";

import { writeThemeCookie } from "@/lib/themes";
import { VIEW_ATTRIBUTES, type AppearanceView } from "./custom-tokens";

/** The custom variables this module put on <html>, so the next view removes exactly those. */
let applied = new Set<string>();

/** Paints <html> with a view: the built-in data-theme, a custom theme's variables and attributes. */
export function applyView(view: AppearanceView, root: HTMLElement = document.documentElement) {
  if (root.dataset.theme !== view.theme) root.dataset.theme = view.theme;
  const next = new Set(Object.keys(view.style));
  // The server may have painted variables of its own before this module ran.
  for (const name of [...applied, ...inlineVariables(root)]) {
    if (!next.has(name)) root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(view.style)) {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }
  applied = next;
  for (const name of VIEW_ATTRIBUTES) {
    const value = view.attrs[name];
    if (value === undefined) root.removeAttribute(name);
    else if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  }
  // The sign-in pages paint from the cookie: a custom theme leaves its dark or light base there.
  writeThemeCookie(view.theme);
}

/** Only the variables a custom view sets (customView), never anyone else's. */
const OWN_VARIABLE = /^--(color-|primary-foreground$|sidebar-primary-foreground$|radius$|radius-card$)/;

function inlineVariables(root: HTMLElement): string[] {
  const names: string[] = [];
  for (let i = 0; i < root.style.length; i += 1) {
    const name = root.style.item(i);
    if (OWN_VARIABLE.test(name)) names.push(name);
  }
  return names;
}

/** A stable key of a view, to tell whether anything would change. */
export function viewKey(view: AppearanceView): string {
  return JSON.stringify([view.theme, view.style, view.attrs]);
}

"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useProfile, useSession, useUserSettings } from "@/features/account/queries";
import { coldCallingKeys } from "@/features/cold-calling/timer-queries";
import type { TimerReading } from "@/features/cold-calling/timer-logic";
import { localHour, PAGE_SETTLE_MS } from "@/features/grady/proactive";
import { useGradyOverlay } from "@/features/grady/overlay-store";
import { track } from "@/lib/analytics/client";
import { todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { GuideSection } from "../ui-map/types";
import { useGuidePrefs, useSaveGuidePrefs } from "./guide-prefs";
import { guide, useGuide } from "./guide-store";
import { guideSectionOf } from "./sections";
import { offerAllowed, struggleOf, trimEvents, type StruggleEvent } from "./struggle";

/** How often the signs are read. */
const TICK_MS = 4000;
/**
 * Like every other offer of Grady's, none in the first 30 seconds after a
 * page loads or changes (docs/grady-pravidla.md), the first visit's too.
 */
const SETTLE_MS = PAGE_SETTLE_MS;
const OFFER_DAYS_KEY = (userId: string) => `gradus.guide.offered.${userId}`;

function readOfferDays(userId: string): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(OFFER_DAYS_KEY(userId)) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeOfferDay(userId: string, section: GuideSection, day: string) {
  try {
    window.localStorage.setItem(OFFER_DAYS_KEY(userId), JSON.stringify({ ...readOfferDays(userId), [section]: day }));
  } catch {
    // Without storage the offer may come again tomorrow anyway.
  }
}

/** A dialog's name for "the same dialog again": its title, else its own tutorial key. Never leaves the browser. */
function dialogId(element: Element): string | null {
  // Grady's own overlays and the guide's menu are no doubt about the section.
  if (element.closest("[data-grady-tour]") || element.querySelector("[data-guide-ask]")) return null;
  const labelled = element.getAttribute("aria-labelledby");
  const title = labelled ? document.getElementById(labelled)?.textContent : null;
  const text = title ?? element.querySelector("h2, [data-tutorial]")?.textContent ?? element.getAttribute("data-tutorial");
  return text ? text.trim().slice(0, 80) : null;
}

/**
 * Grady's own offer of help in a section (30.8), from what the user does
 * only (struggle.ts): the same dialog opened and closed three times without
 * saving, two minutes without doing anything on a first visit, coming back
 * to the same page again and again, three refused fields in a row. At most
 * once per section and day, only with Grady's own messages on, outside quiet
 * hours, never over a dialog, a tutorial or a running timer. A section seen
 * for the first time offers its quick look, once.
 */
export function GuideWatch() {
  const { user } = useSession();
  const profile = useProfile();
  const settings = useUserSettings();
  const format = useFormatSettings();
  const prefs = useGuidePrefs();
  const savePrefs = useSaveGuidePrefs();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const tourActive = useGradyOverlay((state) => state.tourActive);
  const noticeOpen = useGradyOverlay((state) => state.noticeOpen || state.summaryOpen);
  const guideBusy = useGuide((state) => state.run !== null || state.menu.open || state.answer !== null || state.offer !== null);
  const section = guideSectionOf(pathname, search);

  // Every sign carries the section it happened in: coming back to a page counts across sections.
  const events = useRef<(StruggleEvent & { section: GuideSection | null })[]>([]);
  const entered = useRef<{ section: GuideSection | null; at: number }>({ section: null, at: Date.now() });
  const pageSince = useRef(Date.now());
  useEffect(() => {
    pageSince.current = Date.now();
  }, [pathname]);
  const live = useRef({ prefs, guideBusy, tourActive, noticeOpen });
  live.current = { prefs, guideBusy, tourActive, noticeOpen };

  // Grady's own messages on and the person past the start; the owner and a worker alike.
  const enabled = settings.jarvis_proactive && !!profile.onboarding_completed_at && !!profile.tour_completed_at;

  // A new section: the slate is clean; the first visit is remembered.
  useEffect(() => {
    if (entered.current.section !== section) entered.current = { section, at: Date.now() };
    if (section) {
      events.current = trimEvents([...events.current, { type: "visit", path: pathname, at: Date.now(), section }], Date.now());
    }
  }, [section, pathname]);

  // What the user does: dialogs, saves, refused fields.
  useEffect(() => {
    if (!enabled) return;
    const open = new Map<Element, string>();
    const push = (event: StruggleEvent) => {
      events.current = trimEvents([...events.current, { ...event, section: entered.current.section }], Date.now());
    };
    const scan = () => {
      const now = Date.now();
      const present = new Set(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'));
      for (const element of present) {
        if (open.has(element)) continue;
        const id = dialogId(element);
        if (!id) continue;
        open.set(element, id);
        push({ type: "dialogOpen", id, at: now });
      }
      for (const [element, id] of open) {
        if (present.has(element) && element.isConnected) continue;
        open.delete(element);
        push({ type: "dialogClose", id, at: now });
      }
    };
    const observer = new MutationObserver((records) => {
      scan();
      for (const record of records) {
        if (
          record.type === "attributes" &&
          record.attributeName === "aria-invalid" &&
          (record.target as Element).getAttribute("aria-invalid") === "true"
        ) {
          push({ type: "invalid", at: Date.now() });
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-invalid"] });
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.mutation.state.status !== "success") return;
      if ((event.mutation.options.meta as { guide?: boolean } | undefined)?.guide) return;
      push({ type: "saved", at: Date.now() });
    });
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, [enabled, queryClient]);

  // Reading the signs.
  useEffect(() => {
    if (!enabled || !section) return;
    const tick = () => {
      const { prefs: current, guideBusy: busyGuide, tourActive: tour, noticeOpen: notice } = live.current;
      const now = Date.now();
      const timer = queryClient.getQueryData<TimerReading>(coldCallingKeys.timer(user.id));
      const busy =
        busyGuide ||
        tour ||
        notice ||
        Boolean(timer?.running) ||
        document.querySelector('[role="dialog"], [role="alertdialog"]') !== null ||
        document.visibilityState !== "visible";
      const today = todayIsoDate(format);
      const allowed = offerAllowed({
        proactive: true,
        offersOff: !current.offers,
        lastOfferDay: readOfferDays(user.id)[section] ?? null,
        today,
        hour: localHour(new Date(), format.timeZone),
        quietFrom: settings.jarvis_quiet_from,
        quietTo: settings.jarvis_quiet_to,
        busy,
      });
      if (!allowed || !current.loaded || now - pageSince.current < SETTLE_MS) return;
      const firstVisit = !current.seen.includes(section);
      // A first visit: the quiet offer of the quick look, once the page is at rest.
      if (firstVisit && entered.current.section === section) {
        savePrefs.mutate({ seen: [section] });
        writeOfferDay(user.id, section, today);
        track("guide_offer", { section, trigger: "firstVisit", outcome: "shown" });
        guide.offer(section, "firstVisit");
        return;
      }
      const reason = struggleOf({
        events: events.current.filter((event) => event.section === section),
        now,
        firstVisit,
        enteredAt: entered.current.at,
      });
      if (!reason) return;
      events.current = events.current.filter((event) => event.section !== section);
      writeOfferDay(user.id, section, today);
      track("guide_offer", { section, trigger: reason, outcome: "shown" });
      guide.offer(section, reason);
    };
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
    // `savePrefs.mutate` is stable; the rest is read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, section, user.id, format, settings.jarvis_quiet_from, settings.jarvis_quiet_to, queryClient]);

  return null;
}

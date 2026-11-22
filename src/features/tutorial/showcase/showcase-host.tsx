"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { PauseIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Logo } from "@/components/layout/logo";
import { StagedSummary } from "@/components/grady/day-summary";
import type { Locale } from "@/i18n/locales";
import { loginPath } from "@/lib/auth/routes";
import { APP_NAME } from "@/lib/constants";
import { SCENARIOS_WITH_GRADY, showcaseSteps } from "../demo-scripts";
import { createDomRunner, GUEST_FRAME_ID } from "./dom-driver";
import { scenariosOf, showcaseHref, showcaseSearch, type ShowcaseParams } from "./params";
import { createShowcasePlayer, type PlayerSnapshot, type ShowcasePlayer } from "./player";
import { stageBookingPath, stageData } from "./stage-data";
import { useSession } from "@/features/account/queries";
import { stage, START_EVENT, takeShowcaseConfig, useStage, type StagePhase } from "./stage-store";

/**
 * The showcase on the stage account (step 27.4): mounted in the app frame,
 * so it plays on across page changes. It takes the scenario /app/ukazka
 * handed over, hides what does not belong in a video, counts 3-2-1 and plays
 * the steps with the fake cursor, the captions at the bottom and, for the
 * booking scenario, the guest's window. Space pauses, R plays it again on a
 * fresh stage, Esc stops. At the end (or Esc) the stage signs out and is
 * deleted with all its sample data; the end card stays on screen.
 *
 * The recording script reads `data-showcase-state` on <html> and
 * `window.__gradusShowcase` (the captions' times for the .srt).
 */

const OUTRO_MS = 3500;
const COUNTDOWN = [3, 2, 1] as const;

type Recording = {
  phase: StagePhase;
  scenario: string;
  /** Epoch ms of the countdown's start, the first step and the end card. */
  countdownAt: number | null;
  playAt: number | null;
  outroAt: number | null;
  cues: { caption: string; start: number; end: number }[];
  error: PlayerSnapshot["error"];
};

declare global {
  interface Window {
    __gradusShowcase?: Recording;
  }
}

const epoch = () => performance.timeOrigin + performance.now();
const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function phaseOf(snapshot: PlayerSnapshot): StagePhase {
  if (snapshot.status === "paused") return "paused";
  if (snapshot.status === "failed") return "failed";
  return "playing";
}

export function ShowcaseHost() {
  const t = useTranslations("showcase");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { user } = useSession();
  const [config, setConfig] = useState<ShowcaseParams | null>(null);
  const player = useRef<ShowcasePlayer | null>(null);
  const started = useRef(false);
  // R asked for a fresh stage: the old one goes with the new stage's sweep,
  // so a finish still pending must not go out (with the new stage's cookies
  // it would delete the fresh stage and sign it out).
  const replaying = useRef(false);
  const phase = useStage((state) => state.phase);

  // The scenario comes from /app/ukazka (this tab), now or right after it loads.
  useEffect(() => {
    const take = () => {
      const next = takeShowcaseConfig();
      if (next) setConfig(next);
    };
    take();
    window.addEventListener(START_EVENT, take);
    return () => window.removeEventListener(START_EVENT, take);
  }, []);

  const record = useCallback((patch: Partial<Recording>) => {
    const current = window.__gradusShowcase;
    if (current) Object.assign(current, patch);
  }, []);

  const setPhase = useCallback(
    (next: StagePhase) => {
      stage.set({ phase: next });
      document.documentElement.dataset.showcaseState = next;
      record({ phase: next });
    },
    [record],
  );

  const finish = useCallback(
    async (outcome: "done" | "stopped" | "failed", scenario: string, seconds: number) => {
      setPhase("ending");
      // Signed out on purpose: the app frame must not send the stage to the sign-in page.
      document.documentElement.dataset.showcase = "ended";
      // The app closes behind the end card and its last requests finish before the stage goes.
      stage.set({ curtain: true });
      await pause(900);
      if (replaying.current) return;
      await fetch("/api/showcase/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, scenario, seconds }),
      }).catch(() => undefined);
      setPhase("ended");
    },
    [setPhase],
  );

  useEffect(() => {
    if (!config || started.current) return;
    started.current = true;
    const root = document.documentElement;
    root.dataset.showcase = "on";
    const needsGrady = scenariosOf(config.scenario).some((id) => SCENARIOS_WITH_GRADY.has(id));
    if (needsGrady) root.dataset.showcaseGrady = "";
    window.__gradusShowcase = {
      phase: "countdown",
      scenario: config.scenario,
      countdownAt: null,
      playAt: null,
      outroAt: null,
      cues: [],
      error: null,
    };

    const caption = (key: string | null) => (key ? t(`captions.${key}`) : null);
    void (async () => {
      // A breath for the page to settle, then 3-2-1.
      await pause(900);
      setPhase("countdown");
      record({ countdownAt: epoch() });
      for (const number of COUNTDOWN) {
        stage.set({ countdown: number });
        await pause(1000);
      }
      stage.set({ countdown: null });
      setPhase("playing");
      record({ playAt: epoch() });
      const instance = createShowcasePlayer({
        steps: showcaseSteps(config.scenario),
        run: createDomRunner(locale, { guestPath: stageBookingPath(locale, user.id) }),
        onChange: (snapshot) => {
          stage.set({ caption: caption(snapshot.caption) });
          if (snapshot.status === "playing" || snapshot.status === "paused") {
            setPhase(phaseOf(snapshot));
          }
        },
      });
      player.current = instance;
      const result = await instance.play();
      const cues = instance.cues().map((cue) => ({ ...cue, caption: caption(cue.caption) ?? "" }));
      record({ cues, error: result.error });
      const seconds = (epoch() - (window.__gradusShowcase?.playAt ?? epoch())) / 1000;
      stage.set({ caption: null, guestUrl: null, summary: null });
      if (result.status === "done") {
        setPhase("outro");
        record({ outroAt: epoch() });
        stage.cursor({ visible: false });
        await pause(OUTRO_MS);
        await finish("done", config.scenario, seconds);
      } else if (result.status === "failed") {
        stage.set({ error: result.error ? `${result.error.step}: ${result.error.reason}` : null });
        setPhase("failed");
        console.warn("[showcase] a step could not be played", result.error);
        await pause(OUTRO_MS);
        await finish("failed", config.scenario, seconds);
      } else {
        await finish("stopped", config.scenario, seconds);
      }
    })();
  }, [config, finish, locale, record, setPhase, t, user.id]);

  // Space pauses, R plays again on a fresh stage, Esc stops.
  useEffect(() => {
    if (!config) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.isTrusted) return;
      const current = stage.get().phase;
      if (event.key === " " || event.code === "Space") {
        if (current !== "playing" && current !== "paused") return;
        event.preventDefault();
        event.stopPropagation();
        player.current?.toggle();
      } else if (event.key === "Escape") {
        if (current !== "playing" && current !== "paused" && current !== "countdown") return;
        event.preventDefault();
        event.stopPropagation();
        player.current?.stop();
      } else if (event.key === "r" || event.key === "R") {
        if (current === "ending") return;
        event.preventDefault();
        event.stopPropagation();
        replaying.current = true;
        player.current?.stop();
        void fetch("/api/showcase/stage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(new URLSearchParams(showcaseSearch(config)))),
        })
          .then((response) => {
            if (response.ok) window.location.assign(showcaseHref(config));
            else replaying.current = false;
          })
          .catch(() => {
            replaying.current = false;
          });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [config]);

  const over = phase === "outro" || phase === "ending" || phase === "ended";
  if (!config && !over) return null;
  return (
    <>
      <GuestWindow />
      <StagedSummaryCue locale={locale} />
      <Caption />
      <Cursor />
      <Countdown />
      {phase === "paused" && <PausedBadge label={t("paused")} />}
      {phase === "failed" && <FailedNotice />}
      {over && (
        <EndCard ended={phase === "ended"} onLogin={() => router.replace(loginPath(locale))} />
      )}
    </>
  );
}

function Cursor() {
  const cursor = useStage((state) => state.cursor);
  const click = useStage((state) => state.click);
  if (!cursor.visible) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-showcase" data-showcase-cursor="">
      {click.id > 0 && (
        <motion.span
          key={click.id}
          className="absolute size-12 rounded-full border-2 border-teal bg-teal/20"
          style={{ left: click.x - 24, top: click.y - 24 }}
          initial={{ scale: 0.3, opacity: 0.9 }}
          animate={{ scale: 1.4, opacity: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        />
      )}
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        className="absolute drop-shadow-[0_2px_6px_rgb(0_0_0/0.55)] transition-transform duration-100"
        style={{
          left: cursor.x - 3,
          top: cursor.y - 2,
          transform: cursor.pressed ? "scale(0.86)" : "scale(1)",
          transformOrigin: "3px 2px",
        }}
      >
        <path
          d="M3 2 L3 22 L8.5 17 L12.2 25.2 L15.6 23.7 L11.9 15.6 L19.5 15.6 Z"
          className="fill-ink stroke-canvas"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function Caption() {
  const caption = useStage((state) => state.caption);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[7%] z-showcase flex justify-center px-6"
    >
      <AnimatePresence mode="wait">
        {caption && (
          <motion.p
            key={caption}
            data-showcase-caption=""
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            className="max-w-[min(90vw,1100px)] rounded-2xl border border-line-strong bg-canvas/90 px-7 py-3.5 text-center text-[clamp(22px,2.6vw,40px)] leading-tight font-semibold text-ink shadow-glow"
          >
            {caption}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function Countdown() {
  const countdown = useStage((state) => state.countdown);
  return (
    <AnimatePresence>
      {countdown !== null && (
        <motion.div
          key="countdown"
          data-showcase-countdown=""
          className="fixed inset-0 z-showcase grid place-items-center bg-canvas/80"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <AnimatePresence mode="popLayout">
            <motion.span
              key={countdown}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.3, opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="text-[22vmin] leading-none font-black text-ink tabular-nums"
            >
              {countdown}
            </motion.span>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The public booking page as the client sees it, in a window beside the app. */
function GuestWindow() {
  const url = useStage((state) => state.guestUrl);
  const t = useTranslations("showcase");
  return (
    <AnimatePresence>
      {url && (
        <motion.div
          key="guest"
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 60 }}
          transition={{ duration: 0.4 }}
          className="fixed top-[5%] right-[3%] bottom-[16%] z-overlay flex w-[min(620px,52vw)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-canvas shadow-glow-strong"
        >
          <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
            <span aria-hidden className="size-3 rounded-full bg-pink/80" />
            <span aria-hidden className="size-3 rounded-full bg-gold/80" />
            <span aria-hidden className="size-3 rounded-full bg-green/80" />
            <span className="ml-3 truncate rounded-lg bg-canvas-deep/60 px-3 py-1 text-xs text-ink-muted">
              {t("guestWindow", { address: `${window.location.host}${url}` })}
            </span>
          </div>
          <iframe
            id={GUEST_FRAME_ID}
            title={t("guestTitle")}
            src={url}
            className="min-h-0 flex-1 bg-canvas"
            // The guest's page is on the canvas too: no real cursor, no dev overlay.
            onLoad={(event) => {
              const root = event.currentTarget.contentDocument?.documentElement;
              if (root) root.dataset.showcase = "on";
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StagedSummaryCue({ locale }: { locale: Locale }) {
  const summary = useStage((state) => state.summary);
  if (!summary) return null;
  return (
    <StagedSummary
      text={stageData(locale).summary}
      links={[{ key: "todayCrmTasks", count: 1, href: "/app/ukoly-crm" }]}
      onDone={() => stage.set({ summary: null })}
    />
  );
}

function PausedBadge({ label }: { label: string }) {
  return (
    <div className="pointer-events-none fixed top-5 right-5 z-showcase flex items-center gap-2 rounded-full border border-line-strong bg-canvas/90 px-4 py-2 text-sm font-semibold text-ink">
      <PauseIcon aria-hidden className="size-4 text-teal" />
      {label}
    </div>
  );
}

function FailedNotice() {
  const t = useTranslations("showcase");
  const error = useStage((state) => state.error);
  return (
    <div
      role="alert"
      data-showcase-error=""
      className="fixed bottom-5 left-5 z-showcase max-w-md rounded-2xl border border-pink/50 bg-canvas/95 px-4 py-3 text-sm text-ink"
    >
      <p className="font-semibold text-pink">{t("failed")}</p>
      {error && <p className="mt-1 text-xs break-words text-ink-muted">{error}</p>}
    </div>
  );
}

function EndCard({ ended, onLogin }: { ended: boolean; onLogin: () => void }) {
  const t = useTranslations("showcase");
  return (
    <motion.div
      data-showcase-outro=""
      className="fixed inset-0 z-showcase flex flex-col items-center justify-center gap-6 bg-canvas px-6 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
    >
      <Logo className="size-24 rounded-3xl text-5xl" />
      <p className="text-[clamp(36px,5vw,72px)] font-black text-ink">{APP_NAME}</p>
      <p className="max-w-3xl text-[clamp(20px,2.4vw,36px)] font-semibold text-ink-soft">
        {t("outro.tagline")}
      </p>
      {ended && (
        <div className="mt-6 flex flex-col items-center gap-2 text-sm text-ink-muted">
          <p>{t("ended")}</p>
          <button
            type="button"
            onClick={onLogin}
            className="min-h-11 rounded-xl px-4 font-semibold text-violet underline-offset-4 hover:underline"
          >
            {t("signInAgain")}
          </button>
        </div>
      )}
    </motion.div>
  );
}

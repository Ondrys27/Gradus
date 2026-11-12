import type { z } from "zod";
import type { Workspace } from "@/features/account/workspace";
import type { CatalogSectionKey } from "@/features/workers/permissions-catalog";
import type { FormatSettings } from "@/lib/format";
import type { Db, OpsTrack } from "@/lib/ops";
import type { ActionAward, QueryRoot, ToolRisk } from "../actions";
import type { UndoRecord, UndoResult } from "./records";

/**
 * Grady's tools (26.2): everything he may do in the app on the user's word,
 * as data. Each tool names the section and the right of the permission
 * catalog it needs, whether it only reads, and whether it runs at once
 * ("instant", with Undo) or waits for the user's Confirm ("confirm").
 *
 * A tool never gets the admin client: `ctx.db` is the Supabase client of the
 * signed-in user, so row level security, the guards and read-only mode
 * apply exactly as when the user works by hand, and an id the model made up
 * finds nothing.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Sections a tool can belong to: the permission catalog, plus Messages (members of a conversation). */
export type ToolSection = CatalogSectionKey | "chat";

export type ToolContext = {
  /** The signed-in user's own client (RLS). Never the admin client. */
  db: Db;
  userId: string;
  /** The active space: whose data (the owner's user id). */
  workspaceId: string;
  workspace: Workspace;
  settings: FormatSettings;
  timezone: string;
  locale: string;
  /** The user's country (phones without a prefix are read in it). */
  country: string | null;
  /** Texts under `grady.tools` in the user's language. */
  t: Translate;
  /** Server analytics of this user, the same events as the screens record. */
  track: OpsTrack;
};

/** What a tool did, for the model, for Undo and for the card. */
export type ToolOutcome = {
  /** What goes back to the model (as JSON): ids, statuses, counts. Never more than it needs. */
  output: unknown;
  /** The records changed, with their state before, for Undo. Empty for reading tools. */
  records?: UndoRecord[];
  /** The card's line after the change (it may name what the input only had an id of). */
  summary?: string;
  /** "Open" on the card. */
  href?: string | null;
  /** XP and celebrations the browser grants as the screens do (award_xp checks them). */
  awards?: ActionAward[];
};

/** What a proposal shows before it runs; also proves the ids are the user's (read through RLS). */
export type ToolPreview = { summary: string; preview?: string | null; href?: string | null };

export type ToolDef<I = unknown> = {
  /** snake_case, as the model calls it. */
  name: string;
  section: ToolSection;
  /** A key of the permission catalog for `section`; null where the section has no rights (notes, settings, chat). */
  action: string | null;
  /** Another right that also opens the tool (contacts are shared with cold calling). */
  alsoAllowedBy?: { section: ToolSection; action: string };
  kind: "read" | "write";
  risk: ToolRisk;
  /** Only the owner of the space (company structure and rights). */
  ownerOnly?: boolean;
  /** Only in the account's own space (notes are always the account's own). */
  ownSpaceOnly?: boolean;
  /** For the model: what it does and when to use it. English, short. */
  description: string;
  input: z.ZodType<I>;
  /** How many records one call changes, for the bulk confirmation (default 1). */
  count?: (input: I) => number;
  /** The card's line before (or without) the change. */
  describe: (input: I, t: Translate) => string;
  /**
   * A proposal's exact text (a message, an e-mail) and names, read through
   * RLS before the card is shown. Throws ToolError("notFound") for an id the
   * user can not reach.
   */
  prepare?: (ctx: ToolContext, input: I) => Promise<ToolPreview>;
  execute: (ctx: ToolContext, input: I) => Promise<ToolOutcome>;
  /** Undo restores `records` (generic); false for changes that can not be taken back. */
  undoable: boolean;
  /**
   * Undo of its own where writing the old values back is not the way (a
   * move goes through move_task again). Gets the records as stamped after
   * the change; checks them for later changes itself.
   */
  undo?: (ctx: ToolContext, records: UndoRecord[]) => Promise<UndoResult>;
  /** Sections the browser reads again after the change. */
  invalidates: QueryRoot[];
};

/** A known failure of a tool, as a code the model and the card understand. */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ToolError";
  }
}

/** Keeps the input type of a definition while listing it with the others. */
export function defineTool<I>(def: ToolDef<I>): ToolDef<I> {
  return def;
}

/** A tool of the catalog, whatever its input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each tool has its own input type
export type AnyTool = ToolDef<any>;

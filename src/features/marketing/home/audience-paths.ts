/**
 * The eight fields on the website and the game path each one starts on (the
 * `paths` table). Hovering a tile shows that path's first chapter; its
 * milestone titles live in `marketing.home.audience.paths.<path>` and a test
 * keeps them equal to the seeds in supabase/migrations.
 */
export const AUDIENCE_TILES = [
  "craftsman",
  "consultant",
  "ecommerce",
  "gastro",
  "personalServices",
  "creative",
  "it",
  "other",
] as const;
export type AudienceTile = (typeof AUDIENCE_TILES)[number];

export const AUDIENCE_PATH: Record<AudienceTile, AudiencePath> = {
  craftsman: "craftsman",
  consultant: "consultant",
  ecommerce: "ecommerce",
  gastro: "gastro",
  personalServices: "personal_services",
  // Agencies and creatives start on the general path, IT freelancers on the consultant's.
  creative: "general",
  it: "consultant",
  other: "general",
};

export const AUDIENCE_PATHS = [
  "general",
  "craftsman",
  "consultant",
  "ecommerce",
  "gastro",
  "personal_services",
] as const;
export type AudiencePath = (typeof AUDIENCE_PATHS)[number];

/** Milestones of a path's first chapter shown on a tile (`m1`…`m3`). */
export const FIRST_CHAPTER_STEPS = ["m1", "m2", "m3"] as const;

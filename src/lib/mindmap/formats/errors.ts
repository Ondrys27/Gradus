/** Why a mind map file could not be read; the import dialog explains each. */
export const MINDMAP_PARSE_FAILURES = [
  "tooLarge",
  "empty",
  "unsupported",
  "unreadable",
  "unsafe",
  "tooManyNodes",
  "mindnodePackage",
] as const;
export type MindMapParseFailure = (typeof MINDMAP_PARSE_FAILURES)[number];

export class FormatError extends Error {
  constructor(readonly code: MindMapParseFailure) {
    super(`mindmap: ${code}`);
    this.name = "FormatError";
  }
}

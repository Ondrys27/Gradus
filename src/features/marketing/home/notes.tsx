import { cn } from "@/lib/utils";

/**
 * A handwritten remark pointing at one detail of a screenshot. Positions are
 * percentages of the desktop shot: `at` is the detail, `label` the corner of
 * the text the line starts from (`align` says which way the text runs from it).
 */
export type Note = {
  text: string;
  at: [x: number, y: number];
  label: [x: number, y: number];
  align?: "start" | "end";
  /** Degrees; a slight, varying tilt keeps the notes from looking typeset. */
  tilt?: number;
};

function curve([sx, sy]: Note["label"], [tx, ty]: Note["at"]): string {
  // Bends the way a hand would: down (or up) first, then across to the detail.
  const steep = Math.abs(ty - sy) > Math.abs(tx - sx);
  const [cx, cy] = steep ? [sx, ty] : [tx, sy];
  return `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
}

/** Drawn over the desktop screenshot (the frame is `relative`); phones get `NoteList`. */
export function NotesOverlay({ notes }: { notes: readonly Note[] }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden md:block">
      <svg
        className="absolute inset-0 size-full overflow-visible"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {notes.map((note) => (
          <path
            key={note.text}
            d={curve(note.label, note.at)}
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth={1.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={0.85}
          />
        ))}
      </svg>
      {notes.map((note) => (
        <span
          key={`dot-${note.text}`}
          className="absolute size-2.5 -translate-1/2 rounded-full border-2 border-ink bg-violet"
          style={{ left: `${note.at[0]}%`, top: `${note.at[1]}%` }}
        />
      ))}
      {notes.map((note, index) => (
        <p
          key={note.text}
          className={cn(
            "absolute max-w-[15rem] rounded-md bg-canvas/85 px-2 py-0.5 font-hand text-[1.45rem] leading-[1.1] text-ink backdrop-blur-sm lg:text-[1.6rem]",
            note.align === "end" ? "-translate-x-full text-right" : "",
          )}
          style={{
            left: `${note.label[0]}%`,
            top: `${note.label[1]}%`,
            rotate: `${note.tilt ?? (index % 2 ? 1.5 : -2)}deg`,
          }}
        >
          {note.text}
        </p>
      ))}
    </div>
  );
}

/** The same remarks under the picture, where there is no room to draw them. */
export function NoteList({ notes, className }: { notes: readonly Note[]; className?: string }) {
  return (
    <ul
      className={cn(
        "flex flex-col gap-1 font-hand text-[1.35rem] leading-tight text-ink",
        className,
      )}
    >
      {notes.map((note) => (
        <li key={note.text} className="flex gap-2">
          <span aria-hidden className="text-violet">
            ↗
          </span>
          {note.text}
        </li>
      ))}
    </ul>
  );
}

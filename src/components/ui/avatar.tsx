import { UserRoundIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Up to two initials from a name or e-mail, e.g. "Ondřej Otava" → "OO". */
export function initialsOf(name: string | null | undefined): string {
  const clean = (name ?? "").split("@")[0].trim();
  if (!clean) return "";
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]];
  return letters
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

export function Avatar({
  src,
  name,
  className,
}: {
  src?: string | null;
  /** Used for initials when there is no picture. */
  name?: string | null;
  className?: string;
}) {
  const initials = initialsOf(name);
  return (
    <span
      className={cn(
        "relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-violet/50 bg-violet/15 text-sm font-semibold text-violet select-none",
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- small user upload served by Supabase
        <img src={src} alt="" className="size-full object-cover" draggable={false} />
      ) : initials ? (
        <span aria-hidden>{initials}</span>
      ) : (
        <UserRoundIcon aria-hidden className="size-[45%]" />
      )}
    </span>
  );
}

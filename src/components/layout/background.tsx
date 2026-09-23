/** Fixed app backdrop: 100 px grid plus a violet (bottom-left) and teal (top-right) glow. */
export function Background() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-canvas">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-grid)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-grid)_1px,transparent_1px)] bg-size-[100px_100px]" />
      <div className="absolute -bottom-[30vw] -left-[20vw] aspect-square w-[60vw] rounded-full bg-violet opacity-35 blur-[140px]" />
      <div className="absolute -top-[22vw] -right-[15vw] aspect-square w-[45vw] rounded-full bg-teal opacity-30 blur-[140px]" />
    </div>
  );
}

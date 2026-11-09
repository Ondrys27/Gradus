/**
 * The backdrop of the public booking pages (24.5): the canvas with three
 * quiet layers in motion. A sparse dot grid drifts one cell every 70 s, three
 * thin lines wave along the bottom, and one wide band of the brand colours
 * breathes over 16 s. Everything is masked away from the middle, where the
 * page is read, and nothing is blurred. Only transforms and opacity animate,
 * each on its own compositor layer, so the main thread does nothing; with
 * reduced motion the layers stand still and the picture is the same.
 */
export function BookingBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-canvas">
      {/* The breathing tint: violet low left, teal high right, a plain linear band. */}
      <div
        className="absolute inset-0 animate-[booking-breathe_16s_ease-in-out_infinite] motion-reduce:animate-none"
        style={{
          backgroundImage:
            "linear-gradient(115deg, color-mix(in oklab, var(--color-violet) 14%, transparent) 0%, transparent 42%, transparent 58%, color-mix(in oklab, var(--color-teal) 10%, transparent) 100%)",
        }}
      />
      {/* The dot grid: one cell larger on every side, so the drift never shows an edge. */}
      <div
        className="absolute -inset-14 animate-[booking-drift_70s_linear_infinite] opacity-60 motion-reduce:animate-none"
        style={{
          backgroundImage: "radial-gradient(circle, var(--color-line-strong) 1px, transparent 1.6px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, transparent 35%, black 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, transparent 35%, black 100%)",
          willChange: "transform",
        }}
      />
      {/* Three thin lines along the bottom; the path repeats every 1200 px, the wave moves one period. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[38vh] min-h-56"
        style={{
          maskImage: "linear-gradient(to top, black 30%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to top, black 30%, transparent 100%)",
        }}
      >
        <svg
          className="absolute bottom-0 left-0 h-full w-[calc(100%+1200px)] animate-[booking-wave_80s_linear_infinite] motion-reduce:animate-none"
          style={{ willChange: "transform" }}
          viewBox="0 0 3600 400"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M0 250 C150 220 250 220 400 250 C550 280 650 280 800 250 C950 220 1050 220 1200 250 C1350 280 1450 280 1600 250 C1750 220 1850 220 2000 250 C2150 280 2250 280 2400 250 C2550 220 2650 220 2800 250 C2950 280 3050 280 3200 250 C3350 220 3450 220 3600 250"
            stroke="var(--color-line-strong)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M0 300 C200 270 400 270 600 300 C800 330 1000 330 1200 300 C1400 270 1600 270 1800 300 C2000 330 2200 330 2400 300 C2600 270 2800 270 3000 300 C3200 330 3400 330 3600 300"
            stroke="var(--color-violet)"
            strokeOpacity="0.35"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M0 340 C100 325 200 325 300 340 C400 355 500 355 600 340 C700 325 800 325 900 340 C1000 355 1100 355 1200 340 C1300 325 1400 325 1500 340 C1600 355 1700 355 1800 340 C1900 325 2000 325 2100 340 C2200 355 2300 355 2400 340 C2500 325 2600 325 2700 340 C2800 355 2900 355 3000 340 C3100 325 3200 325 3300 340 C3400 355 3500 355 3600 340"
            stroke="var(--color-teal)"
            strokeOpacity="0.28"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useIsFirstPaint } from "./first-paint";

function Probe({ seen }: { seen: boolean[] }) {
  seen.push(useIsFirstPaint());
  return null;
}

describe("useIsFirstPaint", () => {
  it("is true for everything in the first paint and false for later mounts", () => {
    const first: boolean[] = [];
    const { rerender } = render(
      <>
        <Probe seen={first} />
        <Probe seen={first} />
      </>,
    );
    expect(first).toEqual([true, true]);

    // A re-render keeps the answer the component started with.
    rerender(
      <>
        <Probe seen={first} />
        <Probe seen={first} />
      </>,
    );
    expect(first.every(Boolean)).toBe(true);

    // A page mounted after a client-side navigation animates.
    const later: boolean[] = [];
    render(<Probe seen={later} />);
    expect(later).toEqual([false]);
  });
});

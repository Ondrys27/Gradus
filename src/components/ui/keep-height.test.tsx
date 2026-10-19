import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeepHeight, useHoldHeight } from "./keep-height";

function Content({ loading }: { loading: boolean }) {
  useHoldHeight(loading);
  return <p>{loading ? "loading" : "ready"}</p>;
}

function regionOf(container: HTMLElement) {
  return container.querySelector("[data-testid=region]") as HTMLDivElement;
}

describe("KeepHeight", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height: 480,
    } as DOMRect);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps the old height while the swapped-in content loads, then lets go", () => {
    const view = render(
      <KeepHeight token="a" data-testid="region">
        <Content loading={false} />
      </KeepHeight>,
    );
    expect(regionOf(view.container).style.minHeight).toBe("");

    view.rerender(
      <KeepHeight token="b" data-testid="region">
        <Content key="b" loading />
      </KeepHeight>,
    );
    expect(regionOf(view.container).style.minHeight).toBe("480px");

    view.rerender(
      <KeepHeight token="b" data-testid="region">
        <Content key="b" loading={false} />
      </KeepHeight>,
    );
    expect(regionOf(view.container).style.minHeight).toBe("");
  });

  it("holds nothing when the new content is ready at once", () => {
    const view = render(
      <KeepHeight token="a" data-testid="region">
        <Content loading={false} />
      </KeepHeight>,
    );
    view.rerender(
      <KeepHeight token="b" data-testid="region">
        <Content key="b" loading={false} />
      </KeepHeight>,
    );
    expect(regionOf(view.container).style.minHeight).toBe("");
  });

  it("holds nothing on the first render, even while loading", () => {
    const view = render(
      <KeepHeight token="a" data-testid="region">
        <Content loading />
      </KeepHeight>,
    );
    expect(regionOf(view.container).style.minHeight).toBe("");
  });

  it("lets go after the longest hold even if the content never says it is done", () => {
    vi.useFakeTimers();
    const view = render(
      <KeepHeight token="a" data-testid="region" maxHoldMs={1000}>
        <Content loading={false} />
      </KeepHeight>,
    );
    view.rerender(
      <KeepHeight token="b" data-testid="region" maxHoldMs={1000}>
        <Content key="b" loading />
      </KeepHeight>,
    );
    expect(regionOf(view.container).style.minHeight).toBe("480px");
    act(() => vi.advanceTimersByTime(1000));
    expect(regionOf(view.container).style.minHeight).toBe("");
  });
});

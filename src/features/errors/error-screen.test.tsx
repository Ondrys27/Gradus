import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { ErrorScreen } from "./error-screen";
import { isErrorCode } from "./error-code";
import { useErrorScreenShown } from "./error-screen-state";

afterEach(cleanup);

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

function renderIn(locale: "cs" | "en", node: ReactNode) {
  const missing: string[] = [];
  const view = render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "cs" ? cs : en}
      onError={(error) => missing.push(error.message)}
    >
      {node}
    </NextIntlClientProvider>,
  );
  expect(missing).toEqual([]);
  return view;
}

function screenFor(error: Error, onRetry = () => {}) {
  return <ErrorScreen error={error} onRetry={onRetry} home="app" homeHref="/app" />;
}

describe("ErrorScreen", () => {
  it("apologises, shows the code and the way home, in both languages", () => {
    renderIn("cs", screenFor(new Error("boom")));
    expect(screen.getByRole("heading", { name: cs.errorPage.title })).toBeTruthy();
    expect(isErrorCode(screen.getByTestId("error-code").textContent)).toBe(true);
    expect(screen.getByRole("link", { name: cs.errorPage.home.app }).getAttribute("href")).toBe(
      "/app",
    );
    cleanup();
    renderIn("en", screenFor(new Error("boom")));
    expect(screen.getByRole("heading", { name: en.errorPage.title })).toBeTruthy();
  });

  it("tries again on request", () => {
    const onRetry = vi.fn();
    renderIn("cs", screenFor(new Error("boom"), onRetry));
    fireEvent.click(screen.getByRole("button", { name: cs.errorPage.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("sends one report per code, empty note allowed, then thanks in the button's place", async () => {
    const error = Object.assign(new Error("boom"), { digest: "2385967390" });
    renderIn("cs", screenFor(error));
    const code = screen.getByTestId("error-code").textContent;

    fireEvent.click(screen.getByRole("button", { name: cs.errorPage.feedback }));
    const send = screen.getByRole("button", { name: cs.errorPage.send });
    // Two quick clicks: one request.
    await act(async () => {
      fireEvent.click(send);
      fireEvent.click(send);
    });
    await waitFor(() => expect(screen.getByText(cs.errorPage.thanks)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/bug-report");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ code, page: "/", digest: "2385967390", locale: "cs" });
    expect(body.description).toBeUndefined();
    expect(screen.queryByRole("button", { name: cs.errorPage.feedback })).toBeNull();

    // The same error shown again (a re-render, another mount) never sends twice.
    cleanup();
    renderIn("cs", screenFor(error));
    expect(screen.getByText(cs.errorPage.thanks)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the note when there is one and offers a retry when sending fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    renderIn("en", screenFor(new Error("boom")));
    fireEvent.click(screen.getByRole("button", { name: en.errorPage.feedback }));
    fireEvent.change(screen.getByLabelText(en.errorPage.feedbackLabel), {
      target: { value: "  I saved a contact  " },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.errorPage.send }));
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(en.errorPage.failed));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.errorPage.send }));
    });
    await waitFor(() => expect(screen.getByText(en.errorPage.thanks)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).description).toBe("I saved a contact");
  });

  it("keeps Jarvis away while it is on screen", () => {
    function Probe() {
      return <span data-testid="probe">{useErrorScreenShown() ? "hidden" : "shown"}</span>;
    }
    const view = renderIn("cs", <Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("shown");
    view.rerender(
      <NextIntlClientProvider locale="cs" messages={cs}>
        <Probe />
        {screenFor(new Error("boom"))}
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("hidden");
    view.rerender(
      <NextIntlClientProvider locale="cs" messages={cs}>
        <Probe />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("shown");
  });
});

import { describe, expect, it, vi } from "vitest";
import { submitReport, type SubmitDeps } from "./submit-report";

function setup(overrides: Partial<SubmitDeps> = {}) {
  const store = vi.fn<SubmitDeps["store"]>(async () => "report-1");
  const attachScreenshot = vi.fn(async () => true);
  const afterStored = vi.fn();
  const deps: SubmitDeps = { userId: "user-1", store, attachScreenshot, afterStored, ...overrides };
  return { deps, store, attachScreenshot, afterStored };
}

const body = { kind: "idea", description: "Dark mode please", page: "/app" };
const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9]).toString("base64")}`;

describe("submitReport", () => {
  it("stores the report under the session's user and tells the aftermath", async () => {
    const { deps, store, afterStored } = setup();
    expect(await submitReport(body, deps)).toEqual({
      status: 200,
      body: { ok: true, screenshot: false },
    });
    expect(store).toHaveBeenCalledWith(expect.objectContaining({ kind: "idea" }), "user-1");
    expect(afterStored).toHaveBeenCalledWith(expect.anything(), "report-1", false);
  });

  it("refuses a signed-out sender", async () => {
    const { deps, store } = setup({ userId: null });
    expect((await submitReport(body, deps)).status).toBe(401);
    expect(store).not.toHaveBeenCalled();
  });

  it("refuses a malformed body or a screenshot that is not a JPEG before storing", async () => {
    const { deps, store } = setup();
    expect((await submitReport({ ...body, user_id: "other" }, deps)).status).toBe(400);
    expect((await submitReport({ ...body, description: "" }, deps)).status).toBe(400);
    expect(
      (await submitReport({ ...body, screenshot: "data:image/jpeg;base64,AAAA" }, deps)).status,
    ).toBe(400);
    expect(store).not.toHaveBeenCalled();
  });

  it("answers 429 at the limit and does nothing more", async () => {
    const { deps, afterStored } = setup({ store: async () => null });
    expect(await submitReport(body, deps)).toEqual({ status: 429, body: { error: "limited" } });
    expect(afterStored).not.toHaveBeenCalled();
  });

  it("uploads a valid screenshot, and keeps the report when the upload fails", async () => {
    const ok = setup();
    expect((await submitReport({ ...body, screenshot: jpeg }, ok.deps)).body).toEqual({
      ok: true,
      screenshot: true,
    });
    expect(ok.attachScreenshot).toHaveBeenCalledWith("report-1", "user-1", expect.any(Buffer));

    const failing = setup({
      attachScreenshot: async () => Promise.reject(new Error("storage down")),
    });
    expect((await submitReport({ ...body, screenshot: jpeg }, failing.deps)).body).toEqual({
      ok: true,
      screenshot: false,
    });
    expect(failing.afterStored).toHaveBeenCalledWith(expect.anything(), "report-1", false);
  });
});

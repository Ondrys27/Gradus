import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminViewLink, AdminViewMain, AdminViewProvider } from "./admin-view";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));

describe("AdminViewLink", () => {
  afterEach(cleanup);
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
  });

  it("changes the view without scrolling to the top", () => {
    render(
      <AdminViewProvider>
        <AdminViewMain>
          <AdminViewLink href="/admin/funkce?tab=pipeline">Pipeline</AdminViewLink>
        </AdminViewMain>
      </AdminViewProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Pipeline" }));
    expect(push).toHaveBeenCalledWith("/admin/funkce?tab=pipeline", { scroll: false });
  });

  it("leaves a click with a modifier (new tab) to the browser", () => {
    render(
      <AdminViewProvider>
        <AdminViewLink href="/admin/funkce?tab=pipeline">Pipeline</AdminViewLink>
      </AdminViewProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Pipeline" }), { metaKey: true });
    expect(push).not.toHaveBeenCalled();
  });
});

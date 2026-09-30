import { describe, expect, it } from "vitest";
import { overdueDays, taskVisualState } from "./task-status";

describe("taskVisualState", () => {
  it("shows the task's own status when nothing blocks it", () => {
    expect(taskVisualState({ status: "todo" }, 0)).toBe("todo");
    expect(taskVisualState({ status: "in_progress" }, 0)).toBe("in_progress");
    expect(taskVisualState({ status: "done" }, 0)).toBe("done");
  });

  it("is locked while subtasks are open, whatever its own status", () => {
    expect(taskVisualState({ status: "todo" }, 2)).toBe("locked");
    expect(taskVisualState({ status: "in_progress" }, 1)).toBe("locked");
  });
});

describe("overdueDays", () => {
  const today = "2026-09-30";

  it("counts whole days past the due date", () => {
    expect(overdueDays({ status: "todo", due_date: "2026-09-27" }, today)).toBe(3);
    expect(overdueDays({ status: "in_progress", due_date: "2026-08-31" }, today)).toBe(30);
  });

  it("is zero on the due date, without one, or once done", () => {
    expect(overdueDays({ status: "todo", due_date: today }, today)).toBe(0);
    expect(overdueDays({ status: "todo", due_date: null }, today)).toBe(0);
    expect(overdueDays({ status: "done", due_date: "2026-09-01" }, today)).toBe(0);
  });
});

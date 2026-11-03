import { describe, expect, it } from "vitest";
import {
  buildCompanyTree,
  depthOf,
  flattenCompanyTree,
  groupFilter,
  managerChoices,
  membershipDiff,
  membersByGroup,
  moveWorker,
  OWNER_ROOT,
  planManagerMove,
  pruneTree,
  subtreeIds,
  wouldCreateCycle,
  type CompanyNode,
  type CompanyPerson,
} from "./tree";

function person(id: string, managerId: string | null, groupIds: string[] = []): CompanyPerson {
  return {
    id,
    name: id.toUpperCase(),
    jobTitle: null,
    status: "active",
    managerId,
    userId: null,
    avatarUrl: null,
    openTasks: 0,
    openDeals: 0,
    groupIds,
  };
}

// owner · ├ a · │ ├ b · │ │ └ c · │ │   └ d · │ └ e · └ f
const people = [
  person("a", null, ["sales"]),
  person("b", "a"),
  person("c", "b", ["sales"]),
  person("d", "c"),
  person("e", "a"),
  person("f", null),
];

/** The tree as "id(children…)", easy to compare. */
function shape(node: CompanyNode): string {
  return node.children.length ? `${node.id}(${node.children.map(shape).join(",")})` : node.id;
}

describe("buildCompanyTree", () => {
  it("hangs the owner's people under the owner and everyone under their manager, by name", () => {
    expect(shape(buildCompanyTree(people))).toBe("owner(a(b(c(d)),e),f)");
  });

  it("gives a worker their own branch with them on top", () => {
    const branch = people.filter((p) => ["b", "c", "d"].includes(p.id));
    const root = buildCompanyTree(
      branch.map((p) => (p.id === "b" ? { ...p, managerId: null } : p)),
      "b",
    );
    expect(root.person?.id).toBe("b");
    expect(shape(root)).toBe("b(c(d))");
  });

  it("never loses anyone: an unknown manager or a loop ends right under the root", () => {
    const odd = [person("x", "gone"), person("y", "z"), person("z", "y")];
    const root = buildCompanyTree(odd);
    expect(root.children.map((child) => child.id).sort()).toEqual(["x", "y"]);
    expect(shape(root)).toBe("owner(x,y(z))");
  });

  it("handles a deep chain (the interface counts on 5+ levels)", () => {
    const chain = Array.from({ length: 12 }, (_, index) =>
      person(`p${index}`, index === 0 ? null : `p${index - 1}`),
    );
    const rows = flattenCompanyTree(buildCompanyTree(chain), new Set());
    expect(rows).toHaveLength(13);
    expect(rows.at(-1)!.depth).toBe(12);
    expect(depthOf(chain, "p11")).toBe(12);
  });
});

describe("cycles", () => {
  it("refuses the worker themself and anyone below them as the new manager", () => {
    expect(wouldCreateCycle(people, "a", "a")).toBe(true);
    expect(wouldCreateCycle(people, "a", "b")).toBe(true);
    expect(wouldCreateCycle(people, "a", "d")).toBe(true);
    expect(wouldCreateCycle(people, "b", "e")).toBe(false);
    expect(wouldCreateCycle(people, "d", null)).toBe(false);
    expect(wouldCreateCycle(people, "d", OWNER_ROOT)).toBe(false);
  });

  it("explains a refused move and says whether a fine one changes anything", () => {
    expect(planManagerMove(people, "b", "d")).toEqual({ ok: false, error: "cycle" });
    expect(planManagerMove(people, "b", "nobody")).toEqual({ ok: false, error: "unknown" });
    expect(planManagerMove(people, "nobody", "a")).toEqual({ ok: false, error: "unknown" });
    expect(planManagerMove(people, "b", "a")).toEqual({ ok: true, changed: false, managerId: "a" });
    expect(planManagerMove(people, "b", OWNER_ROOT)).toEqual({
      ok: true,
      changed: true,
      managerId: null,
    });
  });

  it("offers every manager but the worker's own branch, the owner first", () => {
    const choices = managerChoices(people, "b").map((choice) => `${choice.id}:${choice.depth}`);
    expect(choices).toEqual(["owner:0", "a:1", "e:2", "f:1"]);
  });
});

describe("moving a subtree", () => {
  it("takes everything below the worker along and leaves the rest as it was", () => {
    const before = subtreeIds(people, "b");
    expect([...before].sort()).toEqual(["b", "c", "d"]);
    const after = moveWorker(people, "b", "f");
    expect(shape(buildCompanyTree(after))).toBe("owner(a(e),f(b(c(d))))");
    expect([...subtreeIds(after, "b")].sort()).toEqual(["b", "c", "d"]);
    expect(depthOf(after, "d")).toBe(4);
    // Only one row changed.
    expect(after.filter((p, index) => p !== people[index]).map((p) => p.id)).toEqual(["b"]);
  });

  it("can put a branch right under the owner and back", () => {
    const up = moveWorker(people, "c", null);
    expect(shape(buildCompanyTree(up))).toBe("owner(a(b,e),c(d),f)");
    expect(shape(buildCompanyTree(moveWorker(up, "c", "b")))).toBe(shape(buildCompanyTree(people)));
  });

  it("keeps any sequence of allowed moves a tree that holds everyone once", () => {
    let current = [...people];
    const ids = people.map((p) => p.id);
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 1000;
    for (let step = 0; step < 300; step++) {
      const worker = ids[next() % ids.length];
      const target = next() % 4 === 0 ? OWNER_ROOT : ids[next() % ids.length];
      const plan = planManagerMove(current, worker, target);
      if (plan.ok) current = moveWorker(current, worker, plan.managerId);
      else expect(plan.error).toBe("cycle");
      const rows = flattenCompanyTree(buildCompanyTree(current), new Set());
      expect(rows.map((row) => row.node.id).sort()).toEqual([OWNER_ROOT, ...ids].sort());
      // Every reached person sits under their own manager.
      for (const row of rows.slice(1)) {
        const parent = row.node.person!.managerId ?? OWNER_ROOT;
        expect(subtreeIds(current, parent === OWNER_ROOT ? row.node.id : parent)).toContain(
          row.node.id,
        );
      }
    }
  });
});

describe("rows of the list", () => {
  it("indents by level and folds a collapsed branch into its row", () => {
    const rows = flattenCompanyTree(buildCompanyTree(people), new Set(["b"]));
    expect(rows.map((row) => `${row.node.id}:${row.depth}`)).toEqual([
      "owner:0",
      "a:1",
      "b:2",
      "e:2",
      "f:1",
    ]);
    const b = rows.find((row) => row.node.id === "b")!;
    expect(b.collapsed).toBe(true);
    expect(b.below).toBe(2);
  });
});

describe("group filter", () => {
  it("keeps the members and everyone above them, so the tree keeps its shape", () => {
    const filter = groupFilter(people, "sales")!;
    expect([...filter.members].sort()).toEqual(["a", "c"]);
    expect([...filter.context].sort()).toEqual(["b"]);
    const kept = new Set([...filter.members, ...filter.context]);
    expect(shape(pruneTree(buildCompanyTree(people), kept))).toBe("owner(a(b(c)))");
  });

  it("filters nothing without a group and keeps the root even when nobody matches", () => {
    expect(groupFilter(people, null)).toBeNull();
    const none = groupFilter(people, "empty")!;
    expect(none.members.size).toBe(0);
    expect(shape(pruneTree(buildCompanyTree(people), new Set()))).toBe("owner");
  });
});

describe("group members", () => {
  it("lists the members of each group and what an edit adds and removes", () => {
    expect(membersByGroup(people).get("sales")).toEqual(["a", "c"]);
    expect(membershipDiff(["a", "c"], ["c", "f"])).toEqual({ added: ["f"], removed: ["a"] });
    expect(membershipDiff([], [])).toEqual({ added: [], removed: [] });
  });
});

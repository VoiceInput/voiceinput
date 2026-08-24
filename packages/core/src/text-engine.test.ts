import { describe, expect, it } from "vitest";

import {
  TextOwnershipModel,
  findSingleEdit,
  normalizeInsertion,
} from "./text-engine/ownership-model.js";

describe("text ownership model", () => {
  it("classifies a conservative single edit", () => {
    expect(
      findSingleEdit("alpha voice omega", "prefix alpha voice omega"),
    ).toEqual({
      oldStart: 0,
      oldEnd: 0,
      newEnd: 7,
    });
    expect(
      findSingleEdit("alpha voice omega", "alpha application omega"),
    ).toEqual({
      oldStart: 6,
      oldEnd: 11,
      newEnd: 17,
    });
  });

  it("preserves transcript interiors while normalizing boundaries", () => {
    expect(normalizeInsertion("one", "two", "  exact   interior  ")).toBe(
      " exact   interior ",
    );
    expect(normalizeInsertion("call(", ")", " me ")).toBe("me");
    expect(normalizeInsertion("", "", "  field  ")).toBe("field");
  });

  it("shifts a provisional range through disjoint external edits", () => {
    const model = new TextOwnershipModel("inline");
    model.replaceTarget("alpha omega");
    model.captureSelection({ start: 6, end: 6, direction: "none" });
    model.begin();
    model.applyInterim("voice", true);

    model.reconcileExternalValue("prefix alpha voice omega", null);
    model.applyInterim("changed", true);

    expect(model.value).toBe("prefix alpha changed omega");
    expect(model.getSnapshot().spans).toEqual([
      expect.objectContaining({
        start: 13,
        text: "changed ",
        state: "provisional",
      }),
    ]);
  });

  it("abandons an overlapping provisional range and re-anchors", () => {
    const model = new TextOwnershipModel("inline");
    model.replaceTarget("alpha omega");
    model.captureSelection({ start: 6, end: 6, direction: "none" });
    model.begin();
    model.applyInterim("voice", true);

    model.reconcileExternalValue("alpha application omega", {
      start: 17,
      end: 17,
      direction: "none",
    });
    model.applyInterim("new", true);

    expect(model.value).toBe("alpha application new omega");
    expect(model.getSnapshot().spans).toEqual([
      expect.objectContaining({ text: " new", state: "provisional" }),
    ]);
  });

  it("returns deeply immutable snapshots", () => {
    const model = new TextOwnershipModel("inline");
    model.replaceTarget("");
    model.captureSelection({ start: 0, end: 0, direction: "none" });
    model.begin();
    model.applyFinal("voice", true);

    const snapshot = model.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.selection)).toBe(true);
    expect(Object.isFrozen(snapshot.spans)).toBe(true);
    expect(Object.isFrozen(snapshot.spans[0])).toBe(true);
  });
});

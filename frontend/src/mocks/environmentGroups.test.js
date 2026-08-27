import { describe, expect, it } from "vitest";
import { COURSE_MACHINE_ACCESS_PREVIEW, ENVIRONMENT_GROUP_PREVIEW } from "./environmentGroups";

describe("environment group preview contract", () => {
  it("contains course and quick-practice groups with unique machine ids", () => {
    expect(ENVIRONMENT_GROUP_PREVIEW.map((group) => group.kind)).toEqual([
      "course",
      "quick_practice",
    ]);

    for (const group of ENVIRONMENT_GROUP_PREVIEW) {
      expect(group.title).toBeTruthy();
      expect(group.machines.length).toBeGreaterThan(1);
      expect(new Set(group.machines.map((machine) => machine.id)).size).toBe(group.machines.length);
      expect(group.preview).toBe(true);
    }
  });

  it("reuses the same course environment in class management", () => {
    expect(COURSE_MACHINE_ACCESS_PREVIEW).toBe(ENVIRONMENT_GROUP_PREVIEW[0]);
    expect(COURSE_MACHINE_ACCESS_PREVIEW.kind).toBe("course");
  });
});

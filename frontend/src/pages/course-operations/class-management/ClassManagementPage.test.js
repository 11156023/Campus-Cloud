import { describe, expect, it } from "vitest";
import { classSetupResumeStep } from "./ClassManagementPage";

describe("classSetupResumeStep", () => {
  it("讓未完成班級回到下一個尚未完成的建立步驟", () => {
    expect(classSetupResumeStep({ students: 0, nodes: [], weeks: [] })).toBe(2);
    expect(classSetupResumeStep({ students: 12, nodes: [], weeks: [] })).toBe(3);
    expect(classSetupResumeStep({ students: 12, nodes: [{ id: "main" }], weeks: [] })).toBe(4);
    expect(classSetupResumeStep({
      students: 12,
      nodes: [{ id: "main" }],
      weeks: [{ title: "Linux 權限" }],
    })).toBe(5);
  });
});

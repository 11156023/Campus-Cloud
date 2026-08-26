import { describe, expect, it } from "vitest";
import { parseStudentEmails, templateBuilderPath, weekPayload } from "./ClassSetupPage";

describe("parseStudentEmails", () => {
  it("accepts common separators, normalizes case, and removes duplicates", () => {
    expect(parseStudentEmails("A@EXAMPLE.COM, b@example.com\nA@example.com; c@example.com")).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });
});

describe("weekPayload", () => {
  it("keeps the generated class dates and trims checkpoint titles", () => {
    expect(weekPayload([{ week_number: 1, session_date: "2026-09-07", title: "  完成 SSH 連線  " }])).toEqual([
      {
        week_number: 1,
        session_date: "2026-09-07",
        title: "完成 SSH 連線",
        target_node_key: null,
        status: "draft",
        files: [],
      },
    ]);
  });
});

describe("templateBuilderPath", () => {
  it("建立模板後會返回原班級的環境步驟", () => {
    const destination = templateBuilderPath("class-1");
    const params = new URLSearchParams(destination.split("?")[1]);

    expect(destination).toContain("/course-template-management/new?");
    expect(params.get("returnTo")).toBe("/class-setup?classId=class-1&step=3");
  });
});

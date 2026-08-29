import { describe, expect, it } from "vitest";
import { courseDestination } from "./CoursePathsPage";

describe("courseDestination", () => {
  it("從課程清單直接前往整合任務與機器的學生課程頁", () => {
    expect(courseDestination("path-1")).toBe("/dashboard/course/path-1");
  });
});

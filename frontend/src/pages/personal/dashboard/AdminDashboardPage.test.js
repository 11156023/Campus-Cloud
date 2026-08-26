import { describe, expect, it } from "vitest";
import { buildAdminIssues, countRows, normalizeAssistantPrompt } from "./AdminDashboardPage";

describe("countRows", () => {
  it("supports list and paginated API responses", () => {
    expect(countRows([{}, {}])).toBe(2);
    expect(countRows({ count: 4, data: [] })).toBe(4);
    expect(countRows({ total: 9, items: [] })).toBe(9);
    expect(countRows({ items: [{}, {}, {}] })).toBe(3);
    expect(countRows(null)).toBe(0);
  });
});

describe("buildAdminIssues", () => {
  it("only returns actionable links and keeps errors first", () => {
    const issues = buildAdminIssues({ alerts: 2, failedJobs: 1, requests: 3, batches: 0, aiRequests: 0, unavailable: 0 });
    expect(issues.map((item) => item.path)).toEqual(["/monitoring", "/jobs", "/request-review"]);
    expect(issues.every((item) => item.count > 0)).toBe(true);
  });

  it("returns no cards when everything is clear", () => {
    expect(buildAdminIssues({ alerts: 0, failedJobs: 0, requests: 0, batches: 0, aiRequests: 0, unavailable: 0 })).toEqual([]);
  });
});

describe("admin assistant prompt", () => {
  it("trims the prompt before opening the inline conversation", () => {
    expect(normalizeAssistantPrompt("  幫我檢查節點  ")).toBe("幫我檢查節點");
    expect(normalizeAssistantPrompt(null)).toBe("");
  });
});

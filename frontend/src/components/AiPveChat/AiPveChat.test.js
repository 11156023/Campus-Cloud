import { describe, expect, it } from "vitest";
import { sanitizeAiPveContent } from "./AiPveChat";

describe("sanitizeAiPveContent", () => {
  it("removes internal model markers from visible messages", () => {
    expect(sanitizeAiPveContent("<think>分析中</think>節點正常<|endoftext|>")).toBe("節點正常");
    expect(sanitizeAiPveContent(null)).toBe("");
  });
});

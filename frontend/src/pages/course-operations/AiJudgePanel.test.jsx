import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  CreateCheckChooser,
  getSelectedRubricSource,
  getVisibleRubricSources,
  resolveActiveSessionId,
} from "./AiJudgePanel";

describe("CreateCheckChooser", () => {
  test("以頁內兩個選項呈現，不使用 dialog", () => {
    const html = renderToStaticMarkup(
      <CreateCheckChooser onChoose={() => {}} onCancel={() => {}} />,
    );

    expect(html).toContain("從零開始建立");
    expect(html).toContain("使用已有評分文件");
    expect(html).toContain("返回目前檢查");
    expect(html).toContain("立即開啟空白評分表");
    expect(html).not.toContain('role="dialog"');
  });
});

describe("getSelectedRubricSource", () => {
  const files = [
    { id: "file-other", status: "active", display_name: "其他檢查" },
    { id: "file-selected", status: "active", display_name: "目前檢查" },
    { id: "file-replaced", status: "replaced", display_name: "已取代來源" },
  ];

  test("只回傳目前檢查選用的 active 來源", () => {
    expect(getSelectedRubricSource(files, "file-selected")).toEqual(files[1]);
    expect(getSelectedRubricSource(files, "file-other")).toEqual(files[0]);
  });

  test("沒有選用來源或來源已失效時不回傳其他班級來源", () => {
    expect(getSelectedRubricSource(files, null)).toBeNull();
    expect(getSelectedRubricSource(files, "file-replaced")).toBeNull();
  });
});

describe("getVisibleRubricSources", () => {
  const files = [
    { id: "file-other", status: "active" },
    { id: "file-selected", status: "active" },
    { id: "file-replaced", status: "replaced" },
  ];

  test("預設只顯示目前檢查的來源，明確切換時才展開其他 active 來源", () => {
    expect(getVisibleRubricSources(files, "file-selected")).toEqual([files[1]]);
    expect(getVisibleRubricSources(files, "file-selected", true)).toEqual([files[0], files[1]]);
  });

  test("沒有選用來源時不列出其他來源", () => {
    expect(getVisibleRubricSources(files, null, true)).toEqual([]);
    expect(getVisibleRubricSources(files, "file-missing", true)).toEqual([]);
  });
});

describe("resolveActiveSessionId", () => {
  const sessions = [{ id: "session-1" }, { id: "session-2" }];

  test("沒有目前選擇時保持未選取，不自動帶入第一筆檢查", () => {
    expect(resolveActiveSessionId(null, sessions)).toBeNull();
  });

  test("保留仍存在的選擇，清除已不存在的選擇", () => {
    expect(resolveActiveSessionId("session-2", sessions)).toBe("session-2");
    expect(resolveActiveSessionId("session-missing", sessions)).toBeNull();
  });
});

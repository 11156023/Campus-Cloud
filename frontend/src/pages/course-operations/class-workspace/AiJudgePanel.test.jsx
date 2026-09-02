import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  CreateCheckChooser,
  ChatPanel,
  RubricStats,
  buildProposalDiff,
  getRubricDisplayName,
  getRubricCheckTitle,
  getSessionMenuPosition,
  getSelectedRubricSource,
  getVisibleRubricSources,
  resolveActiveSessionId,
} from "./AiJudgePanel";
import { RUBRIC_POLISH_PROMPT } from "../../../services/aiJudge";

describe("RubricStats", () => {
  const items = [
    { id: "auto", detectable: "auto" },
    { id: "partial", detectable: "partial" },
    { id: "manual-1", detectable: "manual" },
    { id: "manual-2", detectable: "manual" },
  ];

  test("顯示目前可自動偵測比例與重新評估動作", () => {
    const html = renderToStaticMarkup(
      <RubricStats items={items} onReassess={() => {}} />,
    );

    expect(html).toContain("可自動偵測 1（25%）");
    expect(html).toContain("部分可偵測 1（25%）");
    expect(html).toContain("共 4 題");
    expect(html).toContain("評估結果已更新");
    expect(html).toContain("重新評估");
  });

  test("評分項目異動後明確標示舊結果需要重新評估", () => {
    const html = renderToStaticMarkup(
      <RubricStats items={items} needsReview onReassess={() => {}} />,
    );

    expect(html).toContain("需要重新評估");
    expect(html).toContain("下方顯示上次結果");
  });

  test("refine 內部提示詞不會出現在聊天室，並提供清除內容按鈕", () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        messages={[
          { role: "user", content: RUBRIC_POLISH_PROMPT },
          { role: "assistant", content: "已完成潤飾，請確認提案。" },
        ]}
        onSendMessage={() => {}}
        onClearMessages={() => {}}
        isLoading={false}
        hasRubric
      />,
    );

    expect(html).not.toContain(RUBRIC_POLISH_PROMPT);
    expect(html).toContain("已完成潤飾，請確認提案。");
    expect(html).toContain("清除內容");
  });
});

describe("buildProposalDiff", () => {
  test("將 AI 修改轉成可確認差異，且未回傳項目不會被默認刪除", () => {
    const current = [
      { id: "keep", title: "保留", description: "原內容", detectable: "manual" },
      { id: "remove", title: "移除", description: "舊項目", detectable: "manual" },
    ];
    const diff = buildProposalDiff(current, [
      { id: "keep", title: "保留", description: "新內容", detectable: "manual" },
      { id: "new", title: "新增", description: "新項目", detectable: "auto" },
      { id: "remove", operation: "delete", title: "移除" },
    ]);

    expect(diff.map((item) => [item.id, item.operation])).toEqual([
      ["keep", "update"],
      ["new", "add"],
      ["remove", "delete"],
    ]);
  });
});

describe("CreateCheckChooser", () => {
  test("以頁內兩個選項呈現，不使用 dialog", () => {
    const html = renderToStaticMarkup(
      <CreateCheckChooser onChoose={() => {}} onCancel={() => {}} />,
    );

    expect(html).toContain("從零開始建立");
    expect(html).toContain("使用已有評分文件");
    expect(html).toContain("重構");
    expect(html).not.toContain("複製檢查");
    expect(html).toContain("返回目前檢查");
    expect(html).toContain("立即開啟空白評分表");
    expect(html).not.toContain('role="dialog"');
  });
});

describe("uploaded rubric naming", () => {
  test("匯入檔名移除副檔名，且檢查名稱保留檔名主體並限制長度", () => {
    expect(getRubricDisplayName({ name: "AI評分表審核系統_Python服務Running狀態檢測_簡短版.docx" }))
      .toBe("AI評分表審核系統_Python服務Running狀態檢測_簡短版");
    expect(getRubricCheckTitle({ original_filename: "保存的評分表.docx" })).toBe("保存的評分表");
    expect(getRubricCheckTitle({ display_name: "自訂評分表", original_filename: "保存的評分表.docx" })).toBe("自訂評分表");
    expect(getRubricCheckTitle({ name: "  " })).toBe("未命名檢查");
    expect(getRubricCheckTitle({ name: "a".repeat(300) })).toHaveLength(255);
  });
});

describe("session menu positioning", () => {
  test("浮動選單會貼近觸發按鈕並限制在視窗內", () => {
    expect(getSessionMenuPosition(
      { top: 160, right: 780, bottom: 196 },
      { width: 800, height: 600, menuWidth: 220, menuHeight: 280, margin: 12 },
    )).toEqual({ top: 208, left: 560 });

    expect(getSessionMenuPosition(
      { top: 520, right: 790, bottom: 556 },
      { width: 800, height: 600, menuWidth: 220, menuHeight: 280, margin: 12 },
    )).toEqual({ top: 228, left: 568 });
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

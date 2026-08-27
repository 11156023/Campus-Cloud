import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CreateCheckChooser } from "./AiJudgePanel";

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

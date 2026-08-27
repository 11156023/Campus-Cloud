import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  AiJudgeService,
  RUBRIC_POLISH_PROMPT,
  TEMPLATE_OPTIONS,
  getTemplateLabel,
} from "./aiJudge";

function fakeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const jsonResponse = (body = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

let fetchMock;

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  fetchMock = vi.fn().mockResolvedValue(jsonResponse());
  vi.stubGlobal("fetch", fetchMock);
});

describe("AiJudgeService persistent sessions", () => {
  test("評分環境提供 PostgreSQL 模板", () => {
    expect(TEMPLATE_OPTIONS.map((option) => option.key)).toContain("postgresql");
    expect(getTemplateLabel("postgresql")).toBe("PostgreSQL");
  });

  test("blank 建立請求會帶上評分表名稱與多選環境", async () => {
    await AiJudgeService.createSession("class-1", {
      title: "期中環境檢查",
      creationMode: "blank",
      rubricName: "期中評分表",
      environmentKeys: ["python", "linux"],
      selectedFileId: null,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/teaching-classes/class-1/judge/sessions/");
    expect(JSON.parse(init.body)).toEqual({
      title: "期中環境檢查",
      selected_file_id: null,
      creation_mode: "blank",
      rubric_name: "期中評分表",
      environment_keys: ["python", "linux"],
    });
  });

  test("直接建立空白檢查使用可在編輯頁修改的預設值", async () => {
    await AiJudgeService.createBlankSession("class-1");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      title: "未命名檢查",
      selected_file_id: null,
      creation_mode: "blank",
      rubric_name: "空白評分表",
      environment_keys: ["n8n"],
    });
  });

  test("existing 建立請求只綁定已保存的評分表", async () => {
    await AiJudgeService.createSession("class-1", {
      title: "既有文件檢查",
      creationMode: "existing",
      selectedFileId: "file-1",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      title: "既有文件檢查",
      selected_file_id: "file-1",
      creation_mode: "existing",
    });
  });

  test("釘選使用 server-owned is_pinned 欄位", async () => {
    await AiJudgeService.updateSession("class-1", "check-1", { is_pinned: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/judge/sessions/check-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ is_pinned: true });
  });

  test("複製檢查使用 class-scoped fork endpoint，不傳 rubric snapshot", async () => {
    await AiJudgeService.forkSession("class-1", "check-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      "/api/v1/teaching-classes/class-1/judge/sessions/check-1/fork",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({});
  });

  test("評分表保存請求會帶 optimistic revision", async () => {
    const analysis = { items: [], total_items: 0 };
    await AiJudgeService.updateFileAnalysis("class-1", "file-1", analysis, 7);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/judge/files/file-1/analysis");
    expect(JSON.parse(init.body)).toEqual({ analysis, expected_revision: 7 });
  });

  test("只送出一則新訊息，不回傳 client history", async () => {
    await AiJudgeService.sendSessionMessage("class-1", "session-1", "檢查 nginx");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      "/api/v1/teaching-classes/class-1/judge/sessions/session-1/messages",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ content: "檢查 nginx" });
  });

  test("AI 提案請求可攜帶目前評分表 revision", async () => {
    await AiJudgeService.sendSessionMessage("class-1", "check-1", "補充檢查步驟", 4);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      content: "補充檢查步驟",
      analysis_revision: 4,
    });
  });

  test("潤飾評分表請求會沿用目前評分表 revision 並啟用 refine 模式", async () => {
    await AiJudgeService.sendSessionMessage(
      "class-1",
      "check-1",
      RUBRIC_POLISH_PROMPT,
      4,
      { isRefine: true },
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      content: RUBRIC_POLISH_PROMPT,
      analysis_revision: 4,
      is_refine: true,
    });
  });

  test("session script endpoint 不接受 client rubric snapshot", async () => {
    await AiJudgeService.createSessionScript("class-1", "session-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      "/api/v1/teaching-classes/class-1/judge/sessions/session-1/scripts",
    );
    expect(JSON.parse(init.body)).toEqual({});
  });

  test("腳本產生 request 可超過一般 15 秒 timeout", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce((_url, init) => new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(jsonResponse({ status: "reviewed" })),
          20_000,
        );
        init.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      }));

      const pending = AiJudgeService.createSessionScript("class-1", "session-1");
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(pending).resolves.toEqual({ status: "reviewed" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("刪除 session 使用 DELETE endpoint", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    await AiJudgeService.deleteSession("class-1", "session-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      "/api/v1/teaching-classes/class-1/judge/sessions/session-1",
    );
    expect(init.method).toBe("DELETE");
  });

  test("session filter 會限制腳本 library", async () => {
    await AiJudgeService.listScripts("class-1", "session/1");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/judge/scripts/?session_id=session%2F1");
  });
});

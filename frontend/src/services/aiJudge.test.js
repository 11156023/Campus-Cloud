import { beforeEach, describe, expect, test, vi } from "vitest";
import { AiJudgeService } from "./aiJudge";

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
  test("只送出一則新訊息，不回傳 client history", async () => {
    await AiJudgeService.sendSessionMessage("class-1", "session-1", "檢查 nginx");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      "/api/v1/teaching-classes/class-1/judge/sessions/session-1/messages",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ content: "檢查 nginx" });
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

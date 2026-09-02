import { beforeEach, describe, expect, test, vi } from "vitest";

const { apiPostMock } = vi.hoisted(() => ({
  apiPostMock: vi.fn(),
}));

vi.mock("./api", () => ({
  apiPost: apiPostMock,
}));

import {
  AI_PVE_REQUEST_TIMEOUT_MS,
  AiPveLogService,
} from "./aiPveLog";

describe("AiPveLogService timeout", () => {
  beforeEach(() => {
    apiPostMock.mockReset();
  });

  test("chat 使用 120 秒 timeout", () => {
    const payload = { message: "檢查服務" };

    AiPveLogService.chat(payload);

    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/v1/ai/pve-log/chat",
      payload,
      { timeoutMs: AI_PVE_REQUEST_TIMEOUT_MS },
    );
    expect(AI_PVE_REQUEST_TIMEOUT_MS).toBe(120_000);
  });

  test("SSH confirmation 也使用 120 秒 timeout", () => {
    const request = { token: "token", approved: true, command: "uptime" };

    AiPveLogService.confirmSsh(request);

    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/v1/ai/pve-log/ssh/confirm",
      request,
      { timeoutMs: 120_000 },
    );
  });
});

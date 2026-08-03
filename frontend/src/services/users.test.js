/**
 * users.test.js
 * 驗證 UsersService 的分頁串接行為。
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { UsersService } from "./users";

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });

const makeUsers = (count, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `u-${offset + i}`,
    email: `user${offset + i}@example.com`,
  }));

let fetchMock;

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("UsersService.listAll", () => {
  test("單頁未滿時只請求一次", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ data: makeUsers(3), count: 3 }));

    const all = await UsersService.listAll();

    expect(all).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("滿頁時續抓下一頁並串接結果", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ data: makeUsers(200), count: 250 }))
      .mockResolvedValueOnce(jsonRes({ data: makeUsers(50, 200), count: 250 }));

    const all = await UsersService.listAll();

    expect(all).toHaveLength(250);
    expect(all[0].id).toBe("u-0");
    expect(all[249].id).toBe("u-249");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("skip=200");
  });

  test("抓滿 count 後停止，不再多打一次", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ data: makeUsers(200), count: 200 }));

    const all = await UsersService.listAll();

    expect(all).toHaveLength(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

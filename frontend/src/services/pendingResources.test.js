/**
 * pendingResources.test.js
 * 驗證「我的資源」建立中 placeholder 的判斷：
 * 已消耗（機器被刪除／轉範本）的 approved 申請單即使 vmid 為空也不是建立中。
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./vmRequests", () => ({
  VmRequestsService: { list: vi.fn(), cancel: vi.fn() },
}));

import { VmRequestsService } from "./vmRequests";
import {
  CONSUMED_REQUEST_MARKERS,
  fetchPendingResources,
  isConsumedRequest,
  isCreatingRequest,
  pendingSignature,
} from "./pendingResources";

const DELETED = "Resource deleted by user";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isCreatingRequest", () => {
  test("審核中一律是建立中", () => {
    expect(isCreatingRequest({ status: "pending", vmid: null })).toBe(true);
  });

  test("已核准但尚未開出機器是建立中", () => {
    expect(isCreatingRequest({ status: "approved", vmid: null })).toBe(true);
    expect(isCreatingRequest({ status: "approved", vmid: undefined })).toBe(true);
  });

  test("已核准且 vmid 已寫回不是建立中", () => {
    expect(isCreatingRequest({ status: "approved", vmid: 480 })).toBe(false);
  });

  test("已刪除機器的申請單即使 vmid 被清空也不是建立中（test-123 案例）", () => {
    const consumed = {
      status: "approved",
      vmid: null,
      provisioning_status: "failed",
      provisioning_error: DELETED,
      review_comment: DELETED,
      resource_warning: DELETED,
    };
    expect(isCreatingRequest(consumed)).toBe(false);
  });

  test("其他終態不是建立中", () => {
    for (const status of ["rejected", "cancelled", "expired"]) {
      expect(isCreatingRequest({ status, vmid: null })).toBe(false);
    }
  });
});

describe("isConsumedRequest", () => {
  test("三種系統標記、三個欄位任一命中都算已消耗", () => {
    for (const marker of CONSUMED_REQUEST_MARKERS) {
      expect(isConsumedRequest({ review_comment: marker })).toBe(true);
      expect(isConsumedRequest({ resource_warning: marker })).toBe(true);
      expect(isConsumedRequest({ provisioning_error: marker })).toBe(true);
    }
  });

  test("審核人留的一般備註不算已消耗", () => {
    expect(isConsumedRequest({ review_comment: "OK，已核准" })).toBe(false);
    expect(isConsumedRequest({ provisioning_error: "clone failed: timeout" })).toBe(false);
    expect(isConsumedRequest({})).toBe(false);
    expect(isConsumedRequest(null)).toBe(false);
  });
});

describe("fetchPendingResources", () => {
  test("只回傳建立中的申請，濾掉已消耗與已開通的單", async () => {
    VmRequestsService.list.mockResolvedValueOnce({
      data: [
        { id: "a", status: "pending", vmid: null },
        { id: "b", status: "approved", vmid: null },
        { id: "c", status: "approved", vmid: 481 },
        { id: "d", status: "approved", vmid: null, review_comment: DELETED },
        { id: "e", status: "cancelled", vmid: null },
      ],
    });

    const items = await fetchPendingResources();

    expect(items.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("後端回空資料時回傳空陣列", async () => {
    VmRequestsService.list.mockResolvedValueOnce(undefined);
    expect(await fetchPendingResources()).toEqual([]);
  });
});

describe("pendingSignature", () => {
  test("同一組申請不論順序簽章相同", () => {
    const a = { id: "1", status: "approved", vmid: null, provisioning_status: "running" };
    const b = { id: "2", status: "pending", vmid: null, provisioning_status: null };
    expect(pendingSignature([a, b])).toBe(pendingSignature([b, a]));
  });

  test("階段變化會改變簽章", () => {
    const before = [{ id: "1", status: "approved", vmid: null, provisioning_status: "running" }];
    const after = [{ id: "1", status: "approved", vmid: 480, provisioning_status: "completed" }];
    expect(pendingSignature(before)).not.toBe(pendingSignature(after));
  });
});

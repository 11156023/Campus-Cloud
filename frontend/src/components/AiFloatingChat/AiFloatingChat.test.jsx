/**
 * AiFloatingChat.test.jsx
 * 導覽助手的兩個純函式：問題該問誰、流程走到哪一步。
 */

import { describe, expect, test } from "vitest";
import { stepStatuses, wantsNavigation } from "./AiFloatingChat";

const STEPS = [
  { path: "/my-resources", status: "current" },
  { path: "/reverse-proxy", status: "todo" },
  { path: "/firewall", status: "todo" },
];

describe("wantsNavigation", () => {
  test("整件事的描述交給導覽，才走得到流程", () => {
    expect(wantsNavigation("我要申請一台機器")).toBe(true);
    expect(wantsNavigation("如何把網站公開出去")).toBe(true);
    expect(wantsNavigation("幫我開一個班級")).toBe(true);
  });

  test("原本的導覽句型仍然成立", () => {
    expect(wantsNavigation("帶我到我的資源")).toBe(true);
    expect(wantsNavigation("申請審核在哪裡")).toBe(true);
  });

  test("比較與選型問題留給推薦 AI", () => {
    expect(wantsNavigation("我該申請 LXC 還是 VM？")).toBe(false);
    expect(wantsNavigation("我適合使用哪種 AI 服務？")).toBe(false);
    expect(wantsNavigation("推薦我一個規格")).toBe(false);
  });
});

describe("stepStatuses", () => {
  test("以使用者目前所在頁面決定進度", () => {
    expect(stepStatuses(STEPS, "/reverse-proxy")).toEqual(["done", "current", "todo"]);
    expect(stepStatuses(STEPS, "/firewall")).toEqual(["done", "done", "current"]);
  });

  test("目前頁面不在流程裡時，沿用後端算好的狀態", () => {
    expect(stepStatuses(STEPS, "/account")).toEqual(["current", "todo", "todo"]);
  });

  test("後端也沒標記時，原樣顯示而不是全部歸零", () => {
    const noCurrent = [
      { path: "/a", status: "todo" },
      { path: "/b", status: "todo" },
    ];
    expect(stepStatuses(noCurrent, "/zzz")).toEqual(["todo", "todo"]);
  });
});

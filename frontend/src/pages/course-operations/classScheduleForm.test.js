import { describe, expect, it } from "vitest";
import {
  classSchedulePayload,
  createClassScheduleForm,
} from "./classScheduleForm";

describe("class schedule form", () => {
  it("uses the same normalized fields for setup and management editing", () => {
    expect(
      createClassScheduleForm({
        name: "Linux 實務",
        code: "LINUX-115",
        term: "115-1",
        location: "A201",
        start_date: "2026-09-07",
        end_date: "2027-01-11",
        weekday: 0,
        start_time: "09:10:00",
        end_time: "12:00:00",
        timezone: "Asia/Taipei",
        boot_lead_minutes: 15,
      }),
    ).toEqual({
      name: "Linux 實務",
      code: "LINUX-115",
      term: "115-1",
      location: "A201",
      startDate: "2026-09-07",
      endDate: "2027-01-11",
      weekday: 0,
      startTime: "09:10",
      endTime: "12:00",
      timezone: "Asia/Taipei",
      bootLeadMinutes: 15,
    });
  });

  it("builds one consistent API payload", () => {
    expect(
      classSchedulePayload({
        name: " Linux 實務 ",
        code: " LINUX-115 ",
        term: " 115-1 ",
        location: " ",
        startDate: "2026-09-07",
        endDate: "2027-01-11",
        weekday: "0",
        startTime: "09:10",
        endTime: "12:00",
        timezone: "Asia/Taipei",
        bootLeadMinutes: "15",
      }),
    ).toEqual({
      name: "Linux 實務",
      code: "LINUX-115",
      term: "115-1",
      location: null,
      start_date: "2026-09-07",
      end_date: "2027-01-11",
      weekday: 0,
      start_time: "09:10",
      end_time: "12:00",
      timezone: "Asia/Taipei",
      boot_lead_minutes: 15,
    });
  });
});

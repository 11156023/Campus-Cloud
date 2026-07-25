import { apiDelete, apiGet, apiPost } from "./api";

/** 虛擬教室：session 管理走 REST，信令與觀看資料面走 WS（見 ClassroomStudentLayer / WatchDialog）。 */
export const ClassroomService = {
  /** 群組學生清單（含 VM 狀態，教師/管理員） */
  listStudents(groupId) {
    return apiGet(`/api/v1/classroom/groups/${groupId}/students`);
  },

  listClassStudents(classId) {
    return apiGet(`/api/v1/classroom/classes/${classId}/students`);
  },

  listClassBroadcastSources(classId) {
    return apiGet(`/api/v1/classroom/classes/${classId}/broadcast-sources`);
  },

  /** 開啟 session（mode: "broadcast" 需帶 group_id；"monitor" 只看單台） */
  createSession({ vmid, mode, group_id = null, class_id = null }) {
    const body = { vmid, mode };
    if (group_id != null) body.group_id = group_id;
    if (class_id != null) body.class_id = class_id;
    return apiPost("/api/v1/classroom/sessions", body);
  },

  /** 結束 session */
  stopSession(sessionId) {
    return apiDelete(`/api/v1/classroom/sessions/${sessionId}`);
  },

  /** 控制權：action = "take" | "release" */
  setControl(sessionId, action) {
    return apiPost(`/api/v1/classroom/sessions/${sessionId}/control`, { action });
  },

  /** 進行中的 session 列表（教師/管理員） */
  listSessions() {
    return apiGet("/api/v1/classroom/sessions");
  },

  /** 目前對自己生效的廣播（學生輪詢用） */
  getLive() {
    return apiGet("/api/v1/classroom/live");
  },
};

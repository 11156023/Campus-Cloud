import { apiDelete, apiGet, apiPatch, apiPost, apiPostMultipart, apiPut } from "./api";

export const TeachingClassesService = {
  list() { return apiGet("/api/v1/teaching-classes"); },
  create(body) { return apiPost("/api/v1/teaching-classes", body); },
  get(classId) { return apiGet(`/api/v1/teaching-classes/${classId}`); },
  update(classId, body) { return apiPatch(`/api/v1/teaching-classes/${classId}`, body); },
  addStudents(classId, emails) { return apiPost(`/api/v1/teaching-classes/${classId}/students`, { emails }); },
  removeStudent(classId, studentId) { return apiDelete(`/api/v1/teaching-classes/${classId}/students/${studentId}`); },
  importStudents(classId, file) {
    const body = new FormData();
    body.append("file", file);
    return apiPostMultipart(`/api/v1/teaching-classes/${classId}/students/import-csv`, body);
  },
  generateWeeks(classId) { return apiPost(`/api/v1/teaching-classes/${classId}/generate-weeks`, {}); },
  replaceMachines(classId, nodes) { return apiPut(`/api/v1/teaching-classes/${classId}/machines`, nodes); },
  replaceWeeks(classId, weeks) { return apiPut(`/api/v1/teaching-classes/${classId}/weeks`, weeks); },
  uploadWeekFile(classId, weekId, file) {
    const body = new FormData();
    body.append("file", file);
    return apiPostMultipart(`/api/v1/teaching-classes/${classId}/weeks/${weekId}/files`, body);
  },
  deleteWeekFile(classId, weekId, fileId) { return apiDelete(`/api/v1/teaching-classes/${classId}/weeks/${weekId}/files/${fileId}`); },
  provision(classId) { return apiPost(`/api/v1/teaching-classes/${classId}/provision`, {}); },
  provisionStatus(classId) { return apiGet(`/api/v1/teaching-classes/${classId}/provision-status`); },
};

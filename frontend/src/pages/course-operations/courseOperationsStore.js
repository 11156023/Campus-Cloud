import { classCatalog, classWeeks, templateCatalog } from "./courseOperationsMock";

const TEMPLATE_KEY = "skylab.course-operation.templates.v1";
const CLASS_KEY = "skylab.course-operation.classes.v1";

function read(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("course-operations:changed", { detail: { key } }));
}

export function listCourseTemplates() {
  const saved = read(TEMPLATE_KEY, {});
  const defaults = Object.fromEntries(templateCatalog.map((item) => [item.id, item]));
  return Object.values({ ...defaults, ...saved });
}

export function getCourseTemplate(id) {
  return listCourseTemplates().find((item) => String(item.id) === String(id));
}

export function saveCourseTemplate(template) {
  const saved = read(TEMPLATE_KEY, {});
  const now = new Date();
  const id = template.id && template.id !== "new" ? template.id : `course-template-${Date.now()}`;
  const previous = saved[id] ?? templateCatalog.find((item) => item.id === id);
  const next = {
    ...template,
    id,
    code: template.code.trim(),
    name: template.name.trim(),
    description: template.description.trim(),
    version: previous?.version ?? 1,
    updatedAt: now.toLocaleDateString("zh-TW"),
    status: template.status ?? "draft",
    classes: previous?.classes ?? 0,
  };
  write(TEMPLATE_KEY, { ...saved, [id]: next });
  return next;
}

export function getClassSettings(classId) {
  const saved = read(CLASS_KEY, {});
  const demo = classCatalog.find((item) => String(item.id) === String(classId));
  return saved[classId] ?? (demo ? { ...demo, weeks: classWeeks } : null);
}

export function saveClassSettings(classId, patch) {
  const saved = read(CLASS_KEY, {});
  const current = getClassSettings(classId) ?? {};
  const next = { ...current, ...patch, id: String(classId) };
  write(CLASS_KEY, { ...saved, [classId]: next });
  return next;
}

export function listClassSettings() {
  return Object.values(read(CLASS_KEY, {}));
}


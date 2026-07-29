import { apiGet, apiPost, apiPut } from "./api";

export function courseNodeHasUsableSource(node) {
  return node?.sourceType === "custom"
    ? Boolean(node.customImageRef)
    : Boolean(node?.sourceTemplateId);
}

function normalizeNode(node) {
  return {
    ...node,
    id: node.node_key ?? String(node.id),
    sourceTemplateId: node.source_template_id,
    sourceType: node.source_type ?? "template",
    customImageRef: node.custom_image_ref ?? "",
    customUsername: node.custom_username ?? "student",
    customUnprivileged: node.custom_unprivileged ?? true,
    type: node.resource_type,
    memory: Math.max(1, Math.round(Number(node.memory_mb ?? 1024) / 1024)),
    disk: Number(node.disk_gb ?? 0),
    positionX: Number(node.position_x ?? 80),
    positionY: Number(node.position_y ?? 120),
    image: node.name,
    icon: "dns",
  };
}

export function normalizeCourseEnvironment(item) {
  return {
    ...item,
    id: String(item.id),
    versionId: String(item.version_id),
    updatedAt: item.updated_at
      ? new Date(item.updated_at).toLocaleDateString("zh-TW")
      : "",
    nodes: (item.nodes ?? []).map(normalizeNode),
    edges: (item.edges ?? []).map((edge) => ({
      ...edge,
      id: String(edge.id ?? `${edge.source_node_key}-${edge.target_node_key}`),
      source: edge.source_node_key,
      target: edge.target_node_key,
      direction: edge.direction ?? "one_way",
      protocol: edge.protocol ?? "tcp",
      port: edge.protocol === "any" ? null : Number(edge.port ?? 22),
    })),
  };
}

export function environmentPayload(item) {
  return {
    code: item.code.trim(),
    name: item.name.trim(),
    description: item.description?.trim() || null,
    nodes: item.nodes.map((node, index) => ({
      node_key: String(node.id || `node-${index + 1}`),
      source_type: node.sourceType ?? "template",
      source_template_id: node.sourceType === "custom" ? null : node.sourceTemplateId,
      custom_image_ref: node.sourceType === "custom" ? node.customImageRef : null,
      custom_username: node.sourceType === "custom" && String(node.type).toLowerCase() !== "lxc" ? (node.customUsername || "student") : null,
      custom_unprivileged: node.sourceType === "custom" ? node.customUnprivileged !== false : true,
      name: node.name.trim(),
      role: node.role.trim(),
      resource_type: String(node.type).toLowerCase() === "lxc" ? "lxc" : "qemu",
      cpu: Number(node.cpu),
      memory_mb: Number(node.memory) * 1024,
      disk_gb: Number(node.disk),
      network: node.network?.trim() || "lab-net",
      position_x: Number(node.positionX ?? (80 + index * 260)),
      position_y: Number(node.positionY ?? (120 + (index % 2) * 45)),
    })),
    edges: (item.edges ?? []).map((edge) => ({
      source_node_key: String(edge.source ?? edge.source_node_key),
      target_node_key: String(edge.target ?? edge.target_node_key),
      direction: edge.direction ?? "one_way",
      protocol: edge.protocol ?? "tcp",
      port: edge.protocol === "any" ? null : Number(edge.port ?? 22),
    })),
  };
}

export const CourseEnvironmentsService = {
  async list() {
    return (await apiGet("/api/v1/course-environments")).map(normalizeCourseEnvironment);
  },
  async listPublished() {
    return (await apiGet("/api/v1/course-environments/published")).map(normalizeCourseEnvironment);
  },
  async get(environmentId) {
    return normalizeCourseEnvironment(await apiGet(`/api/v1/course-environments/${environmentId}`));
  },
  async create(item) {
    return normalizeCourseEnvironment(await apiPost("/api/v1/course-environments", environmentPayload(item)));
  },
  async update(environmentId, item) {
    return normalizeCourseEnvironment(await apiPut(`/api/v1/course-environments/${environmentId}`, environmentPayload(item)));
  },
  async publish(environmentId) {
    return normalizeCourseEnvironment(await apiPost(`/api/v1/course-environments/${environmentId}/publish`, {}));
  },
  async createVersion(environmentId) {
    return normalizeCourseEnvironment(await apiPost(`/api/v1/course-environments/${environmentId}/versions`, {}));
  },
};

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  resources: SkyLabResource[];
  tunnels: SkyLabTunnelInfo[];
}>();

const emit = defineEmits<{
  ssh: [target: { host: string; port: number }];
  rdp: [target: { host: string; port: number }];
}>();

const { t, locale } = useI18n();
const rows = computed(() => props.resources);

const statusTagType = (status: string) => {
  if (status === "running") return "success";
  if (["stopped", "paused"].includes(status)) return "info";
  return "danger";
};

const statusLabel = (status: string) => {
  const labels: Record<string, string> = {
    running: t("resources.status.running"),
    stopped: t("resources.status.stopped"),
    paused: t("resources.status.paused"),
    provisioning: t("resources.status.provisioning"),
    failed: t("resources.status.failed"),
    unknown: t("resources.status.unknown")
  };
  return labels[status] ?? status;
};

const typeLabel = (type?: string) =>
  type === "lxc" ? "LXC" : type === "qemu" ? "VM" : type || "VM";

const tunnelFor = (resource: SkyLabResource, service: string) =>
  props.tunnels.find(
    tunnel =>
      Number(tunnel.vmid) === Number(resource.vmid) &&
      String(tunnel.service).toLowerCase() === service
  );

const validTarget = (tunnel?: SkyLabTunnelInfo) => {
  const port = Number(tunnel?.port);
  return !!tunnel?.host && Number.isInteger(port) && port > 0 && port <= 65535;
};

const canConnect = (resource: SkyLabResource, tunnel?: SkyLabTunnelInfo) =>
  resource.status === "running" && validTarget(tunnel);

const formatExpiry = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale.value === "zh-CN" ? "zh-TW" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
};

const connect = (service: "ssh" | "rdp", tunnel?: SkyLabTunnelInfo) => {
  if (!validTarget(tunnel)) return;
  const target = { host: String(tunnel?.host), port: Number(tunnel?.port) };
  if (service === "ssh") emit("ssh", target);
  else emit("rdp", target);
};
</script>

<template>
  <el-table :data="rows" size="small" class="machine-table">
    <el-table-column :label="t('resources.table.name')" min-width="210">
      <template #default="{ row }">
        <div class="name-cell">
          <span class="name-icon">
            <IconifyIconOffline
              :icon="row.type === 'lxc' ? 'terminal-rounded' : 'computer'"
            />
          </span>
          <span class="name-copy">
            <strong>{{ row.name }}</strong>
            <small>{{ typeLabel(row.type) }} · VMID {{ row.vmid }}</small>
          </span>
        </div>
      </template>
    </el-table-column>

    <el-table-column :label="t('resources.table.environment')" min-width="155">
      <template #default="{ row }">
        <div class="cell-stack">
          <span>{{
            row.environment_type || t("resources.customEnvironment")
          }}</span>
          <small>{{ row.os_info || "—" }}</small>
        </div>
      </template>
    </el-table-column>

    <el-table-column :label="t('resources.table.status')" width="100">
      <template #default="{ row }">
        <el-tag size="small" :type="statusTagType(row.status)">
          {{ statusLabel(row.status) }}
        </el-tag>
      </template>
    </el-table-column>

    <el-table-column :label="t('resources.table.ip')" min-width="130">
      <template #default="{ row }">
        <span class="mono">{{ row.ip_address || "—" }}</span>
      </template>
    </el-table-column>

    <el-table-column :label="t('resources.table.expiry')" width="120">
      <template #default="{ row }">
        <span class="muted">{{ formatExpiry(row.expiry_date) }}</span>
      </template>
    </el-table-column>

    <el-table-column :label="t('resources.table.node')" width="95">
      <template #default="{ row }">
        <span class="muted">{{ row.node || "—" }}</span>
      </template>
    </el-table-column>

    <el-table-column
      :label="t('home.tunnels.action')"
      min-width="175"
      align="right"
    >
      <template #default="{ row }">
        <div class="row-actions">
          <el-button
            v-if="tunnelFor(row, 'ssh')"
            size="small"
            type="primary"
            plain
            :disabled="!canConnect(row, tunnelFor(row, 'ssh'))"
            @click="connect('ssh', tunnelFor(row, 'ssh'))"
          >
            <IconifyIconOffline icon="terminal-rounded" />
            SSH
          </el-button>
          <el-button
            v-if="tunnelFor(row, 'rdp')"
            size="small"
            type="primary"
            plain
            :disabled="!canConnect(row, tunnelFor(row, 'rdp'))"
            @click="connect('rdp', tunnelFor(row, 'rdp'))"
          >
            <IconifyIconOffline icon="desktop-windows-rounded" />
            RDP
          </el-button>
          <span
            v-if="!tunnelFor(row, 'ssh') && !tunnelFor(row, 'rdp')"
            class="action-empty"
          >
            {{ t("home.machines.unavailable") }}
          </span>
        </div>
      </template>
    </el-table-column>
  </el-table>
</template>

<style lang="scss" scoped>
.machine-table {
  --el-table-header-bg-color: color-mix(in srgb, var(--color-hover) 55%, white);
  --el-table-row-hover-bg-color: color-mix(
    in srgb,
    var(--color-primary) 5%,
    white
  );
  --el-table-border-color: var(--color-divider);
}

.name-cell,
.name-icon,
.name-copy,
.cell-stack,
.row-actions {
  display: flex;
}

.name-cell {
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.name-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
  background: var(--color-hover);
  border-radius: 8px;
}

.name-copy,
.cell-stack {
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.name-copy strong,
.cell-stack span {
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name-copy small,
.cell-stack small,
.muted,
.action-empty {
  color: var(--color-text-muted);
  font-size: 11px;
}

.mono {
  color: var(--color-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}

.row-actions {
  min-height: 28px;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.row-actions :deep(.el-button) {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  margin-left: 0;
}
</style>

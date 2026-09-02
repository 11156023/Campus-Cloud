<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";

type ConnectionRow = SkyLabTunnelInfo & {
  resource?: SkyLabResource;
};

const props = defineProps<{
  connections: ConnectionRow[];
}>();

const emit = defineEmits<{
  copy: [value: string];
  ssh: [port: number];
  rdp: [port: number];
}>();

const { t } = useI18n();
const rows = computed(() => props.connections);
const endpoint = (row: ConnectionRow) => `127.0.0.1:${row.visitor_port}`;
const validPort = (row: ConnectionRow) => {
  const port = Number(row.visitor_port);
  return Number.isInteger(port) && port > 0 && port <= 65535;
};
const canConnect = (row: ConnectionRow) =>
  validPort(row) && (!row.resource || row.resource.status === "running");
const serviceLabel = (service?: string) => String(service || "").toUpperCase();
</script>

<template>
  <el-table :data="rows" size="small" stripe>
    <el-table-column :label="t('resources.table.name')" min-width="170">
      <template #default="{ row }">
        <div class="connection-name">
          <span class="connection-icon">
            <IconifyIconOffline
              :icon="
                String(row.service).toLowerCase() === 'rdp'
                  ? 'desktop-windows-rounded'
                  : 'terminal-rounded'
              "
            />
          </span>
          <span class="connection-copy">
            <strong>{{
              row.resource?.name || row.vm_name || `VM-${row.vmid}`
            }}</strong>
            <small
              >VMID {{ row.vmid }} ·
              {{ row.resource?.os_info || row.resource?.type || "VM" }}</small
            >
          </span>
        </div>
      </template>
    </el-table-column>
    <el-table-column :label="t('home.tunnels.service')" width="90">
      <template #default="{ row }">
        <el-tag size="small" effect="plain">{{
          serviceLabel(row.service)
        }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column :label="t('home.tunnels.endpoint')" min-width="185">
      <template #default="{ row }">
        <div class="endpoint-cell">
          <span
            class="font-mono"
            :class="{ 'endpoint-invalid': !validPort(row) }"
          >
            {{ endpoint(row) }}
          </span>
          <el-button
            size="small"
            text
            :disabled="!validPort(row)"
            @click="emit('copy', endpoint(row))"
          >
            <IconifyIconOffline icon="content-copy-rounded" />
          </el-button>
        </div>
      </template>
    </el-table-column>
    <el-table-column :label="t('resources.table.status')" width="100">
      <template #default="{ row }">
        <el-tag
          size="small"
          :type="row.resource?.status === 'running' ? 'success' : 'info'"
        >
          {{
            row.resource?.status === "running"
              ? t("resources.status.running")
              : t("resources.status.stopped")
          }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column
      :label="t('home.tunnels.action')"
      width="125"
      align="right"
    >
      <template #default="{ row }">
        <el-tooltip
          :disabled="canConnect(row)"
          :content="
            !validPort(row)
              ? t('home.tunnels.invalidPort')
              : t('home.tunnels.machineStopped')
          "
        >
          <span>
            <el-button
              v-if="String(row.service).toLowerCase() === 'ssh'"
              size="small"
              type="primary"
              :disabled="!canConnect(row)"
              @click="emit('ssh', Number(row.visitor_port))"
            >
              <IconifyIconOffline icon="terminal-rounded" />
              {{ t("home.tunnels.connectSsh") }}
            </el-button>
            <el-button
              v-else-if="String(row.service).toLowerCase() === 'rdp'"
              size="small"
              type="primary"
              :disabled="!canConnect(row)"
              @click="emit('rdp', Number(row.visitor_port))"
            >
              <IconifyIconOffline icon="desktop-windows-rounded" />
              {{ t("home.tunnels.connectRdp") }}
            </el-button>
          </span>
        </el-tooltip>
      </template>
    </el-table-column>
  </el-table>
</template>

<style lang="scss" scoped>
.connection-name,
.connection-icon,
.connection-copy,
.endpoint-cell {
  display: flex;
}

.connection-name,
.endpoint-cell {
  min-width: 0;
  align-items: center;
}

.connection-name {
  gap: 9px;
}

.connection-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
  background: var(--color-hover);
  border-radius: 8px;
}

.connection-copy {
  min-width: 0;
  flex-direction: column;
}

.connection-copy strong {
  overflow: hidden;
  color: var(--color-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-copy small {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.endpoint-cell {
  gap: 3px;
}

.endpoint-invalid {
  color: var(--color-danger);
  text-decoration: line-through;
}

:deep(.el-button) {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}
</style>

<script lang="ts" setup>
import router from "@/router";
import { useAppStore } from "@/store/app";
import { on, removeRouterListeners, send } from "@/utils/ipcUtils";
import {
  findResourceForTunnel,
  groupResourcesByCourse
} from "@/utils/resourceGroups";
import { ElMessage } from "element-plus";
import {
  computed,
  defineComponent,
  onMounted,
  onUnmounted,
  ref,
  watch
} from "vue";
import { useI18n } from "vue-i18n";
import { ipcRouters } from "../../../electron/core/IpcRouter";
import MachineResourceTable from "./MachineResourceTable.vue";

defineComponent({ name: "Home" });

const { t } = useI18n();
const appStore = useAppStore();
const loading = ref(false);
const refreshing = ref(false);
const operationError = ref("");
const expandedCourses = ref<string[]>([]);

const status = computed(() => {
  if (appStore.tunnelStatus.connectionError) return "error";
  if (!appStore.tunnelStatus.running) return "stopped";
  return "running";
});

const orphanResources = computed<SkyLabResource[]>(() => {
  const rows = new Map<number, SkyLabResource>();
  for (const tunnel of appStore.tunnelStatus.tunnels) {
    if (findResourceForTunnel(tunnel, appStore.resources)) continue;
    const vmid = Number(tunnel.vmid);
    if (!Number.isFinite(vmid) || rows.has(vmid)) continue;
    rows.set(vmid, {
      vmid,
      name: tunnel.vm_name || tunnel.name || `VM-${vmid}`,
      type: "qemu",
      status: "running",
      environment_type: null,
      ip_address: null
    });
  }
  return [...rows.values()];
});

const visibleResources = computed(() => [
  ...appStore.resources,
  ...orphanResources.value
]);
const groupedResources = computed(() =>
  groupResourcesByCourse(visibleResources.value)
);
const machineCount = computed(() => visibleResources.value.length);
const resourceAclSignature = computed(() =>
  appStore.resources
    .map(resource =>
      [
        resource.vmid,
        resource.status,
        resource.ip_address,
        resource.can_control
      ].join(":")
    )
    .sort()
    .join("|")
);

watch(
  () => groupedResources.value.courseGroups.map(group => group.id),
  ids => {
    const available = new Set(ids);
    const retained = expandedCourses.value.filter(id => available.has(id));
    expandedCourses.value = [
      ...retained,
      ...ids.filter(id => !retained.includes(id))
    ];
  },
  { immediate: true }
);

watch(resourceAclSignature, (next, previous) => {
  if (
    appStore.tunnelStatus.running &&
    previous !== undefined &&
    next !== previous
  ) {
    send(ipcRouters.TUNNEL.refresh);
  }
});

watch(
  () => appStore.tunnelStatus.running,
  running => {
    if (running) {
      loading.value = false;
      operationError.value = "";
      appStore.refreshResources();
    }
  }
);

const handleConnect = () => {
  loading.value = true;
  operationError.value = "";
  send(ipcRouters.TUNNEL.start);
};

const handleDisconnect = () => {
  loading.value = true;
  operationError.value = "";
  send(ipcRouters.TUNNEL.stop);
};

const refresh = () => {
  appStore.refreshResources();
  if (appStore.tunnelStatus.running) {
    refreshing.value = true;
    send(ipcRouters.TUNNEL.refresh);
  } else {
    send(ipcRouters.TUNNEL.getStatus);
  }
};

const refreshAfterNetworkRecovery = () => {
  if (appStore.tunnelStatus.running) refresh();
};

const goSettings = () => router.push({ name: "Config" });

const openSsh = (target: { host: string; port: number }) => {
  send(ipcRouters.SYSTEM.openSsh, target);
};

const openRdp = (target: { host: string; port: number }) => {
  send(ipcRouters.SYSTEM.openRdp, target);
};

onMounted(() => {
  on(
    ipcRouters.TUNNEL.start,
    () => {
      loading.value = false;
      send(ipcRouters.TUNNEL.getStatus);
    },
    (_code, message) => {
      loading.value = false;
      operationError.value = message;
    }
  );
  on(
    ipcRouters.TUNNEL.refresh,
    (data: TunnelStatusInfo) => {
      refreshing.value = false;
      if (data) appStore.tunnelStatus = data;
      appStore.refreshResources();
    },
    (_code, message) => {
      refreshing.value = false;
      operationError.value = message;
      ElMessage.error(message);
    }
  );
  on(
    ipcRouters.TUNNEL.stop,
    () => {
      loading.value = false;
      send(ipcRouters.TUNNEL.getStatus);
    },
    (_code, message) => {
      loading.value = false;
      ElMessage.error(message);
    }
  );
  on(ipcRouters.TUNNEL.getStatus, (data: TunnelStatusInfo) => {
    if (data) appStore.tunnelStatus = data;
  });

  refresh();
  window.addEventListener("online", refreshAfterNetworkRecovery);
  if (router.currentRoute.value.query.connect === "1") {
    handleConnect();
    router.replace({ name: "Home" });
  }
});

onUnmounted(() => {
  removeRouterListeners(ipcRouters.TUNNEL.start);
  removeRouterListeners(ipcRouters.TUNNEL.stop);
  removeRouterListeners(ipcRouters.TUNNEL.refresh);
  removeRouterListeners(ipcRouters.TUNNEL.getStatus);
  window.removeEventListener("online", refreshAfterNetworkRecovery);
});
</script>

<template>
  <div class="main connect-page">
    <header class="app-topbar">
      <div class="brand">
        <img src="/logo/only/128x128.png" alt="Logo" />
        <span>SkyLab Connect</span>
      </div>
      <div class="topbar-actions">
        <div class="status-pill">
          <span
            class="status-dot"
            :class="{
              'status-dot--success': status === 'running',
              'status-dot--danger': status === 'error',
              'status-dot--muted': status === 'stopped'
            }"
          />
          {{ t(`home.status.${status}`) }}
        </div>
        <button
          type="button"
          class="icon-button"
          :aria-label="t('router.config.title')"
          @click="goSettings"
        >
          <IconifyIconOffline icon="settings" />
        </button>
      </div>
    </header>

    <div class="connect-content">
      <section v-if="status !== 'running'" class="connect-hero">
        <button
          type="button"
          class="connect-button"
          :class="{ 'connect-button--loading': loading }"
          :disabled="loading"
          @click="handleConnect"
        >
          <IconifyIconOffline
            :icon="loading ? 'refresh-rounded' : 'settings-ethernet-rounded'"
          />
          <span>{{
            loading ? t("home.connect.connecting") : t("home.connect.button")
          }}</span>
        </button>
        <h1>{{ t("home.connect.title") }}</h1>
        <p>{{ t("home.connect.description") }}</p>
        <div v-if="operationError || status === 'error'" class="connect-error">
          <IconifyIconOffline icon="error" />
          <span>{{
            operationError || appStore.tunnelStatus.connectionError
          }}</span>
        </div>
      </section>

      <template v-else>
        <div class="resource-header">
          <div>
            <h1>{{ t("resources.webTitle") }}</h1>
            <p>{{ t("resources.webSubtitle") }}</p>
          </div>
          <div class="resource-actions">
            <el-button size="small" :loading="refreshing" @click="refresh">
              <IconifyIconOffline icon="refresh-rounded" />
              {{ t("common.refresh") }}
            </el-button>
            <el-button
              size="small"
              type="danger"
              plain
              :loading="loading"
              @click="handleDisconnect"
            >
              <IconifyIconOffline icon="stop-rounded" />
              {{ t("home.button.stop") }}
            </el-button>
          </div>
        </div>

        <div class="connection-summary">
          <span class="summary-check">
            <IconifyIconOffline icon="check-circle-rounded" />
          </span>
          <span>{{
            t("home.machines.summary", {
              machines: machineCount,
              courses: groupedResources.courseGroups.length
            })
          }}</span>
        </div>

        <div v-if="machineCount" class="resource-sections">
          <section
            v-if="groupedResources.courseGroups.length"
            class="resource-panel"
          >
            <el-collapse v-model="expandedCourses" class="course-collapse">
              <el-collapse-item
                v-for="group in groupedResources.courseGroups"
                :key="group.id"
                :name="group.id"
              >
                <template #title>
                  <div class="course-header">
                    <span class="course-icon">
                      <IconifyIconOffline icon="school" />
                    </span>
                    <span class="course-copy">
                      <strong
                        >{{ t("resources.course.kind") }}｜{{
                          group.title
                        }}</strong
                      >
                      <small>{{
                        t("resources.course.machineCount", {
                          count: group.resources.length
                        })
                      }}</small>
                    </span>
                    <el-tag size="small" type="success">
                      {{
                        t("resources.course.runningCount", {
                          running: group.runningCount,
                          total: group.resources.length
                        })
                      }}
                    </el-tag>
                  </div>
                </template>
                <MachineResourceTable
                  :resources="group.resources"
                  :tunnels="appStore.tunnelStatus.tunnels"
                  @ssh="openSsh"
                  @rdp="openRdp"
                />
              </el-collapse-item>
            </el-collapse>
          </section>

          <section
            v-if="groupedResources.personalResources.length"
            class="resource-panel"
          >
            <div class="section-heading">
              <span class="course-icon">
                <IconifyIconOffline icon="computer" />
              </span>
              <span>
                <strong>{{ t("resources.personal.title") }}</strong>
                <small>{{ t("resources.personal.description") }}</small>
              </span>
            </div>
            <MachineResourceTable
              :resources="groupedResources.personalResources"
              :tunnels="appStore.tunnelStatus.tunnels"
              @ssh="openSsh"
              @rdp="openRdp"
            />
          </section>
        </div>

        <section v-else class="resource-panel empty-state">
          <div class="empty-icon">
            <IconifyIconOffline icon="cloud-off-rounded" />
          </div>
          {{ t("resources.empty") }}
        </section>
      </template>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.connect-page {
  gap: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-surface-glass) 88%, transparent);
  border: 1px solid var(--color-surface-glass-border);
  border-radius: 12px;
  box-shadow: var(--shadow-glass);
  backdrop-filter: blur(16px) saturate(1.25);
}

.app-topbar {
  display: flex;
  min-height: 64px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  border-bottom: 1px solid var(--color-divider);
}

.brand,
.topbar-actions,
.resource-actions,
.connection-summary,
.course-header,
.section-heading {
  display: flex;
  align-items: center;
}

.brand {
  gap: 10px;
  color: var(--color-text-primary);
  font-size: 15px;
  font-weight: 700;
}

.brand img {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
}

.topbar-actions,
.resource-actions {
  gap: 8px;
}

.icon-button {
  display: flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 19px;
  border-radius: 8px;
  cursor: pointer;
}

.icon-button:hover {
  color: var(--color-primary);
  background: var(--color-hover);
}

.connect-content {
  flex: 1;
  min-height: 0;
  padding: 22px;
  overflow: auto;
}

.connect-hero {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px;
  text-align: center;
}

.connect-button {
  display: flex;
  width: 164px;
  height: 164px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 11px;
  color: white;
  font-size: 16px;
  font-weight: 700;
  background: linear-gradient(
    145deg,
    var(--color-primary),
    var(--color-primary-dark)
  );
  border: 0;
  border-radius: 50%;
  box-shadow:
    0 18px 40px color-mix(in srgb, var(--color-primary) 34%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.connect-button svg {
  font-size: 50px;
}

.connect-button:hover:not(:disabled) {
  box-shadow:
    0 22px 48px color-mix(in srgb, var(--color-primary) 44%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  transform: translateY(-4px) scale(1.02);
}

.connect-button--loading {
  cursor: wait;
  animation: connect-pulse 1.6s ease-in-out infinite;
}

.connect-button--loading svg {
  animation: connect-spin 1.2s linear infinite;
}

.connect-hero h1 {
  margin-top: 30px;
  color: var(--color-text-primary);
  font-size: 26px;
  font-weight: 700;
}

.connect-hero > p {
  max-width: 430px;
  margin-top: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.connect-error {
  display: flex;
  max-width: 520px;
  align-items: flex-start;
  gap: 7px;
  margin-top: 20px;
  padding: 10px 14px;
  color: var(--color-danger);
  font-size: 12px;
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  border-radius: 8px;
  text-align: left;
}

.resource-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.resource-header h1 {
  color: var(--color-text-primary);
  font-size: 22px;
  font-weight: 700;
}

.resource-header p {
  margin-top: 4px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.resource-actions :deep(.el-button) {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  margin-left: 0;
}

.connection-summary {
  gap: 8px;
  margin-top: 18px;
  padding: 10px 14px;
  color: var(--color-text-secondary);
  font-size: 12px;
  background: color-mix(in srgb, var(--color-success) 7%, var(--color-surface));
  border: 1px solid
    color-mix(in srgb, var(--color-success) 18%, var(--color-border));
  border-radius: 8px;
}

.summary-check {
  color: var(--color-success);
  font-size: 19px;
}

.resource-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}

.resource-panel {
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
}

.course-collapse {
  border: 0;
}

.course-collapse :deep(.el-collapse-item__header) {
  height: auto;
  min-height: 64px;
  padding: 9px 16px;
  color: var(--color-text-primary);
  background: color-mix(in srgb, var(--color-primary) 5%, var(--color-surface));
  border-bottom-color: var(--color-divider);
}

.course-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 0;
}

.course-collapse :deep(.el-collapse-item__wrap) {
  border-bottom-color: var(--color-divider);
}

.course-header {
  width: 100%;
  min-width: 0;
  gap: 9px;
  padding-right: 12px;
}

.course-icon {
  display: flex;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
  font-size: 19px;
  background: var(--color-hover);
  border-radius: 8px;
}

.course-copy,
.section-heading > span:last-child {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.course-copy strong,
.section-heading strong {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.course-copy small,
.section-heading small {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.section-heading {
  gap: 9px;
  padding: 13px 16px;
  color: var(--color-text-primary);
  background: color-mix(in srgb, var(--color-primary) 5%, var(--color-surface));
  border-bottom: 1px solid var(--color-divider);
}

@keyframes connect-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes connect-pulse {
  50% {
    box-shadow:
      0 20px 50px color-mix(in srgb, var(--color-primary) 48%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.35);
    transform: scale(1.025);
  }
}

@media (max-width: 720px) {
  .connect-content {
    padding: 16px;
  }

  .resource-header {
    flex-direction: column;
  }
}
</style>

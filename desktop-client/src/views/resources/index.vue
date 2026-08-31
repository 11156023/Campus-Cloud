<script lang="ts" setup>
import Breadcrumb from "@/layout/compoenets/Breadcrumb.vue";
import { useAppStore } from "@/store/app";
import { groupResourcesByCourse } from "@/utils/resourceGroups";
import { computed, defineComponent, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ResourceTable from "./ResourceTable.vue";

defineComponent({ name: "Resources" });

const { t } = useI18n();
const appStore = useAppStore();
const expandedCourses = ref<string[]>([]);

const refresh = () => {
  if (appStore.loggedIn) appStore.refreshResources();
};

const runningCount = computed(
  () =>
    appStore.resources.filter(resource => resource.status === "running").length
);
const stoppedCount = computed(
  () =>
    appStore.resources.filter(resource => resource.status === "stopped").length
);
const groupedResources = computed(() =>
  groupResourcesByCourse(appStore.resources)
);

watch(
  () => groupedResources.value.courseGroups.map(group => group.id),
  ids => {
    const available = new Set(ids);
    const retained = expandedCourses.value.filter(id => available.has(id));
    const added = ids.filter(id => !retained.includes(id));
    expandedCourses.value = [...retained, ...added];
  },
  { immediate: true }
);

onMounted(refresh);
</script>

<template>
  <div class="main">
    <breadcrumb />
    <div class="app-container-breadcrumb">
      <div class="page-surface">
        <div class="page-header">
          <div>
            <div class="page-title">{{ t("resources.title") }}</div>
            <div class="page-subtitle">
              {{
                t("resources.summary", {
                  total: appStore.resources.length,
                  courses: groupedResources.courseGroups.length
                })
              }}
            </div>
          </div>
          <el-button size="small" type="primary" @click="refresh">
            <IconifyIconOffline icon="refresh-rounded" />
            {{ t("resources.refresh") }}
          </el-button>
        </div>

        <div class="metric-grid">
          <div class="metric-item">
            <div class="metric-label">{{ t("resources.metrics.total") }}</div>
            <div class="metric-value">{{ appStore.resources.length }}</div>
          </div>
          <div class="metric-item">
            <div class="metric-label">
              {{ t("resources.metrics.courseGroups") }}
            </div>
            <div class="metric-value">
              {{ groupedResources.courseGroups.length }}
            </div>
          </div>
          <div class="metric-item">
            <div class="metric-label">{{ t("home.status.running") }}</div>
            <div class="metric-value metric-value--success">
              {{ runningCount }}
            </div>
          </div>
          <div class="metric-item">
            <div class="metric-label">{{ t("resources.status.stopped") }}</div>
            <div class="metric-value metric-value--muted">
              {{ stoppedCount }}
            </div>
          </div>
        </div>

        <template v-if="appStore.resources.length">
          <section
            v-if="groupedResources.courseGroups.length"
            class="section-panel course-section"
          >
            <div class="section-header">
              <div>
                <div class="section-title">
                  {{ t("resources.course.title") }}
                </div>
                <div class="section-subtitle">
                  {{ t("resources.course.description") }}
                </div>
              </div>
            </div>

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
                      <strong>{{ group.title }}</strong>
                      <small>{{
                        t("resources.course.machineCount", {
                          count: group.resources.length
                        })
                      }}</small>
                    </span>
                    <span class="course-meta">
                      <el-tag size="small" type="success">
                        {{
                          t("resources.course.runningCount", {
                            running: group.runningCount,
                            total: group.resources.length
                          })
                        }}
                      </el-tag>
                      <span>{{ group.nodeLabel }}</span>
                    </span>
                  </div>
                </template>
                <ResourceTable :resources="group.resources" />
              </el-collapse-item>
            </el-collapse>
          </section>

          <section
            v-if="groupedResources.personalResources.length"
            class="section-panel"
          >
            <div class="section-header">
              <div>
                <div class="section-title">
                  {{ t("resources.personal.title") }}
                </div>
                <div class="section-subtitle">
                  {{ t("resources.personal.description") }}
                </div>
              </div>
            </div>
            <ResourceTable :resources="groupedResources.personalResources" />
          </section>
        </template>

        <section v-else class="section-panel">
          <div class="empty-state">
            <div class="empty-icon">
              <IconifyIconOffline icon="cloud-off-rounded" />
            </div>
            {{ t("resources.empty") }}
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.page-header :deep(.el-button) {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.metric-value--success {
  color: var(--color-success);
}

.metric-value--muted {
  color: var(--color-text-muted);
}

.section-subtitle {
  margin-top: 3px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.course-section {
  overflow: hidden;
}

.course-collapse {
  border: 0;
}

.course-collapse :deep(.el-collapse-item__header) {
  height: auto;
  min-height: 66px;
  padding: 10px 16px;
  color: var(--color-text-primary);
  background: color-mix(in srgb, var(--color-hover) 55%, transparent);
  border-bottom-color: var(--color-divider);
}

.course-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 0;
}

.course-collapse :deep(.el-collapse-item__wrap) {
  border-bottom-color: var(--color-divider);
}

.course-header {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding-right: 12px;
}

.course-icon {
  display: flex;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
  font-size: 20px;
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
}

.course-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.course-copy strong {
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.course-copy small,
.course-meta {
  color: var(--color-text-muted);
  font-size: 11px;
}

.course-meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
}

@media (max-width: 760px) {
  .course-meta > span:last-child {
    display: none;
  }
}
</style>

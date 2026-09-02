<script lang="ts" setup>
import router from "@/router";
import { useAppStore } from "@/store/app";
import { on, removeRouterListeners, send } from "@/utils/ipcUtils";
import { ElMessage } from "element-plus";
import { defineComponent, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ipcRouters } from "../../../electron/core/IpcRouter";

defineComponent({ name: "Login" });

const { t } = useI18n();
const appStore = useAppStore();
const waiting = ref(false);

const handleLogin = () => {
  waiting.value = true;
  send(ipcRouters.AUTH.startLogin);
};

const handleCancel = () => {
  send(ipcRouters.AUTH.logout);
  waiting.value = false;
};

const goSettings = () => router.push({ name: "Config" });

const authEventHandler = (_event: any, args: ApiResponse<any>) => {
  if (!args || args.bizCode !== "A1000") return;
  const payload = args.data;
  if (!payload) return;
  waiting.value = false;
  if (payload.type === "login-success") {
    ElMessage.success(t("login.success"));
    appStore.loggedIn = true;
    appStore.refreshAuth();
    appStore.refreshResources();
    router.replace({ name: "Home", query: { connect: "1" } });
  } else if (payload.type === "login-failure") {
    ElMessage.error(t("login.failure", { error: payload.error || "unknown" }));
  }
};

onMounted(() => {
  on(ipcRouters.AUTH.startLogin, () => {
    waiting.value = true;
  });
  window.electronIpcRenderer.on("auth:event", authEventHandler);
});

onUnmounted(() => {
  removeRouterListeners(ipcRouters.AUTH.startLogin);
  window.electronIpcRenderer.removeListener("auth:event", authEventHandler);
});
</script>

<template>
  <div class="login-page">
    <button
      type="button"
      class="settings-button"
      :aria-label="t('router.config.title')"
      @click="goSettings"
    >
      <IconifyIconOffline icon="settings" />
    </button>
    <div class="login-panel">
      <img src="/logo/only/128x128.png" class="login-logo" alt="Logo" />
      <div class="brand-name">SkyLab Connect</div>
      <h1 class="login-title">{{ t("login.connectTitle") }}</h1>
      <p class="login-description">
        {{ t("login.connectDescription") }}
      </p>
      <button
        type="button"
        class="connect-button"
        :class="{ 'connect-button--waiting': waiting }"
        :disabled="waiting"
        @click="handleLogin"
      >
        <IconifyIconOffline
          :icon="waiting ? 'refresh-rounded' : 'settings-ethernet-rounded'"
        />
        <span>{{
          waiting ? t("login.waitingShort") : t("login.connect")
        }}</span>
      </button>
      <p class="login-hint">
        {{ waiting ? t("login.waiting") : t("login.firstUseHint") }}
      </p>
      <button
        v-if="waiting"
        type="button"
        class="cancel-button"
        @click="handleCancel"
      >
        {{ t("login.cancelButton") }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.login-page {
  position: relative;
  z-index: 1;
  display: flex;
  width: 100%;
  height: 100vh;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.settings-button {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 20px;
  background: color-mix(in srgb, var(--color-surface) 72%, transparent);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: 0.2s ease;
}

.settings-button:hover {
  color: var(--color-primary);
  background: var(--color-hover);
}

.login-panel {
  display: flex;
  width: min(100%, 520px);
  flex-direction: column;
  align-items: center;
  padding: 42px 36px;
  text-align: center;
  background: transparent;
}

.login-logo {
  width: 58px;
  height: 58px;
  margin-bottom: 10px;
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
}

.brand-name {
  margin-bottom: 34px;
  color: var(--color-text-primary);
  font-size: 16px;
  font-weight: 700;
}

.login-title {
  margin-bottom: 8px;
  color: var(--color-text-primary);
  font-size: 28px;
  font-weight: 700;
}

.login-description {
  max-width: 380px;
  margin-bottom: 30px;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.connect-button {
  display: flex;
  width: 148px;
  height: 148px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: white;
  font-size: 15px;
  font-weight: 700;
  background: linear-gradient(
    145deg,
    var(--color-primary),
    var(--color-primary-dark)
  );
  border: 0;
  border-radius: 50%;
  box-shadow:
    0 16px 34px color-mix(in srgb, var(--color-primary) 32%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.connect-button svg {
  font-size: 46px;
}

.connect-button:hover:not(:disabled) {
  box-shadow:
    0 20px 42px color-mix(in srgb, var(--color-primary) 42%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  transform: translateY(-3px) scale(1.02);
}

.connect-button:active:not(:disabled) {
  transform: scale(0.98);
}

.connect-button--waiting {
  cursor: wait;
  animation: connect-pulse 1.6s ease-in-out infinite;
}

.connect-button--waiting svg {
  animation: connect-spin 1.2s linear infinite;
}

.login-hint {
  min-height: 42px;
  max-width: 360px;
  margin-top: 22px;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.cancel-button {
  margin-top: 4px;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.cancel-button:hover {
  color: var(--color-danger);
}

@keyframes connect-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes connect-pulse {
  50% {
    box-shadow:
      0 18px 46px color-mix(in srgb, var(--color-primary) 48%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.35);
    transform: scale(1.025);
  }
}
</style>

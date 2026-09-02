<script lang="ts" setup>
import { defineComponent } from "vue";
import AppMain from "./compoenets/AppMain.vue";
import "@/components/IconifyIcon/src/offlineIcon";

defineComponent({
  name: "Layout"
});
</script>
<template>
  <div class="w-full h-full">
    <app-main />
  </div>
</template>

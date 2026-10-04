<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { appearanceVariables, attachClassicFrame } from "@moxi/ui";

const marker = ref<HTMLElement>();
let dispose: (() => void) | undefined;
onMounted(() => {
  const root = document.documentElement;
  if (!root.dataset.uiStyle) {
    root.dataset.uiStyle = "classic";
    for (const [key, value] of Object.entries(
      appearanceVariables({ uiStyle: "classic", uiFont: "guild-wars", uiPanelOpacity: 94 }),
    ))
      root.style.setProperty(key, value);
  }
  const panel = marker.value?.parentElement;
  if (panel) dispose = attachClassicFrame(panel);
});
onUnmounted(() => dispose?.());
</script>

<template><span ref="marker" hidden /></template>

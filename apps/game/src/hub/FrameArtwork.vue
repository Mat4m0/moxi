<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { attachClassicFrame } from "@moxi/ui";

const marker = ref<HTMLElement>();
let dispose: (() => void) | undefined;
onMounted(() => {
  const panel = marker.value?.parentElement;
  if (panel) dispose = attachClassicFrame(panel);
});
onUnmounted(() => dispose?.());
</script>

<template><span ref="marker" hidden /></template>

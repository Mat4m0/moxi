<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import Hub from "./Hub.vue";
const HUB_SHORTCUT = "r";
const open = ref(false);
const isMac = navigator.platform.toLowerCase().includes("mac");
function onKey(event: KeyboardEvent) {
  if (
    (isMac ? event.metaKey : event.ctrlKey) &&
    event.key.toLowerCase() === HUB_SHORTCUT &&
    !event.shiftKey
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) open.value = !open.value;
  }
}
onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));
</script>
<template><Hub v-if="open" @close="open = false" /></template>

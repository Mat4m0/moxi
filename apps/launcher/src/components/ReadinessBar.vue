<script setup lang="ts">
import { computed } from "vue";
import { AlertTriangle, Check, Clock3, WifiOff, X } from "lucide-vue-next";
import type { LauncherData } from "../launcher-data";
const props = defineProps<{ data: LauncherData; error: string }>();
const emit = defineEmits<{ gameFiles: []; dismiss: [] }>();
const state = props.data.state;
const percent = (received: number, total: number) =>
  Math.min(100, Math.round((received / Math.max(1, total)) * 100));
const status = computed(() => {
  if (props.error)
    return {
      title: props.error,
      detail: "Nothing was changed.",
      tone: "danger",
      icon: AlertTriangle,
    };
  const readiness = state.value.readiness;
  if (readiness.state === "repair-required")
    return {
      title: "Game files need repair",
      detail: "Guild Wars cannot start until the game files are ready.",
      tone: "danger",
      icon: AlertTriangle,
      action: "Open Game Files",
    };
  if (readiness.state === "offline-playable")
    return {
      title: "Ready to play offline",
      detail: "Using the game files already on this Mac.",
      tone: "warning",
      icon: WifiOff,
    };
  if (readiness.state === "preparing") {
    const progress = percent(readiness.progress.received, readiness.progress.total);
    return {
      title: `Preparing Guild Wars · ${progress}%`,
      detail: "Downloading the playable client",
      tone: "working",
      icon: Clock3,
      action: "View download",
      progress,
    };
  }
  const download = readiness.backgroundDownload;
  if (download?.status === "running") {
    const progress = percent(download.received, download.total);
    return {
      title: "Downloading game files",
      detail: `${progress}% complete. You can play while this downloads.`,
      tone: "working",
      icon: Clock3,
      progress,
      action: "View download",
    };
  }
  if (download?.status === "paused")
    return {
      title: "Game file download paused",
      detail: "You can play now and resume the offline files when you are ready.",
      tone: "working",
      icon: Clock3,
      action: "View download",
    };
  return { title: "Ready to play", detail: "Guild Wars is available.", tone: "ready", icon: Check };
});
</script>
<template>
  <footer class="launchbar">
    <div
      class="readiness"
      :class="`status-${status.tone}`"
      :role="status.tone === 'danger' ? 'alert' : 'status'"
      :aria-live="status.tone === 'danger' ? 'assertive' : 'polite'"
    >
      <span class="status-icon" aria-hidden="true"><component :is="status.icon" /></span>
      <div class="status-copy">
        <strong>{{ status.title }}</strong
        ><small>{{ status.detail }}</small
        ><progress
          v-if="status.progress !== undefined"
          :value="status.progress"
          max="100"
          :aria-label="`${status.progress}% complete`"
        />
      </div>
      <div v-if="status.action || error" class="status-actions">
        <button v-if="status.action" class="status-action" @click="emit('gameFiles')">
          {{ status.action }}</button
        ><button
          v-if="error"
          class="icon-button"
          aria-label="Dismiss error"
          @click="emit('dismiss')"
        >
          <X />
        </button>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RotateCcw, Wrench } from "lucide-vue-next";
import type { LauncherData } from "../launcher-data";
import { formatBytes, formatProgress } from "../launcher-view-model";
const props = defineProps<{ data: LauncherData }>();
const state = props.data.state;
const download = computed(() =>
  state.value.readiness.state === "playable" ? state.value.readiness.backgroundDownload : null,
);
</script>
<template>
  <h1>Game files</h1>
  <p>
    Game files and required Guild Wars updates are shared by every account and managed
    automatically.
  </p>
  <div class="setting-group">
    <div class="setting-row">
      <span
        ><strong>Guild Wars client</strong
        ><small
          >{{ formatBytes(state.gameFilesInfo.bytes) }} of
          {{ formatBytes(state.gameFilesInfo.totalBytes) }} verified</small
        ></span
      ><span :class="{ good: state.readiness.state !== 'repair-required' }">{{
        state.readiness.state === "repair-required"
          ? "Needs repair"
          : state.readiness.state === "preparing"
            ? "Preparing"
            : "Ready"
      }}</span>
    </div>
    <div v-if="state.readiness.state === 'preparing'" class="download-card">
      <div>
        <strong>Downloading the playable client</strong
        ><span>{{ formatProgress(state.readiness.progress) }}</span>
      </div>
      <progress
        :value="state.readiness.progress.received"
        :max="state.readiness.progress.total || 1"
      />
    </div>
    <div v-else-if="download" class="download-card">
      <div>
        <strong>Complete game download</strong
        ><span v-if="download.status === 'running'"
          >{{ formatProgress(download) }} · You can play now.</span
        ><span v-else-if="download.status === 'paused'">Download paused. You can still play.</span
        ><span v-else>All game files are available offline.</span>
      </div>
      <button
        v-if="download.status === 'running'"
        class="secondary"
        @click="data.download('pause')"
      >
        Pause</button
      ><button
        v-else-if="download.status === 'paused'"
        class="secondary"
        @click="data.download('resume')"
      >
        Resume</button
      ><progress
        v-if="download.status === 'running'"
        :value="download.received"
        :max="download.total || 1"
      />
    </div>
    <div v-if="state.readiness.state === 'repair-required'" class="recovery-card" role="status">
      <div>
        <strong>Repair needed</strong
        ><span
          >A downloaded game file did not pass verification. Repair will download a clean
          copy.</span
        >
      </div>
      <button class="primary" @click="data.download('repair')"><Wrench />Repair game files</button>
    </div>
    <div v-else class="file-actions">
      <button class="secondary" @click="data.download('repair')">
        <Wrench />Check and repair game files</button
      ><small>The launcher restarts to verify the client. Close open game windows first.</small>
    </div>
    <details>
      <summary>Advanced</summary>
      <button class="danger-button" @click="data.download('reset')">
        <RotateCcw />Reset and redownload game files
      </button>
      <p>
        This removes only downloaded Guild Wars client data after restart. Profiles, saved logins,
        application settings, Tools, shortcuts, builds, templates, screenshots, chat logs, and
        window positions are kept.
      </p>
    </details>
  </div>
</template>

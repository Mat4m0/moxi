<script setup lang="ts">
import { computed } from "vue";
import type { LauncherData } from "../launcher-data";
const props = defineProps<{ data: LauncherData }>();
const state = props.data.state;
const presentation = computed(() => {
  const update = state.value.appUpdate;
  if (update.phase === "ready")
    return {
      title: `Launcher version ${update.latestVersion} is ready`,
      detail: "Restart when you are finished playing.",
      action: "Restart and update",
    };
  return {
    title: update.phase === "idle" ? "Launcher updates" : "The launcher is up to date",
    detail: `${update.phase === "idle" ? "Installed version" : "Version"} ${update.currentVersion}`,
    action: "Check now",
  };
});
function checked(event: Event) {
  if (event.currentTarget instanceof HTMLInputElement)
    void props.data.saveSettings({ autoCheckUpdates: event.currentTarget.checked });
}
function channel(event: Event) {
  if (!(event.currentTarget instanceof HTMLSelectElement)) return;
  const value = event.currentTarget.value;
  if (value === "stable" || value === "beta") void props.data.saveSettings({ updateTrack: value });
}
</script>
<template>
  <h1>Updates</h1>
  <div class="setting-group">
    <label
      ><span
        ><strong>Automatically check for launcher updates</strong
        ><small
          >Checks for Guild Wars Reforged app updates. Guild Wars game files update
          separately.</small
        ></span
      ><input type="checkbox" :checked="state.settings.autoCheckUpdates" @change="checked" /></label
    ><label
      ><span><strong>Launcher update channel</strong><small>Stable is recommended.</small></span
      ><select :value="state.settings.updateTrack" @change="channel">
        <option value="stable">Stable</option>
        <option value="beta">Beta</option>
      </select></label
    >
    <div class="setting-row">
      <span
        ><strong>{{ presentation.title }}</strong
        ><small>{{ presentation.detail }}</small></span
      ><button
        :class="state.appUpdate.phase === 'ready' ? 'primary' : 'secondary'"
        @click="state.appUpdate.phase === 'ready' ? data.installUpdate() : data.checkUpdate()"
      >
        {{ presentation.action }}
      </button>
    </div>
  </div>
</template>

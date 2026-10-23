<script setup lang="ts">
import type { LauncherData } from "../launcher-data";
const props = defineProps<{ data: LauncherData }>();
const state = props.data.state;
// The switch shows what Main has saved: it goes back at once and moves when Main answers.
function toggle(id: string, enabled: boolean, event: Event) {
  const box = event.target as HTMLInputElement;
  props.data.setTool(id, box.checked);
  box.checked = enabled;
}
</script>
<template>
  <h1>Tools</h1>
  <p>Switch a tool off to remove it from the Hub in every account. Changes apply at once.</p>
  <div class="setting-group">
    <label v-for="tool in state.tools" :key="tool.id" class="setting-row"
      ><span
        ><strong>{{ tool.name }}</strong
        ><small>{{ tool.description }}</small></span
      ><input
        type="checkbox"
        role="switch"
        :aria-label="tool.name"
        :checked="tool.enabled"
        @change="toggle(tool.id, tool.enabled, $event)"
    /></label>
  </div>
</template>

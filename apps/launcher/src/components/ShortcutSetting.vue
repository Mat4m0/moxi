<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { Ellipsis } from "lucide-vue-next";
import type { LauncherData } from "../launcher-data";
const props = defineProps<{ data: LauncherData }>();
const state = props.data.state;
const capturing = ref(false);
const message = ref("");
function stop() {
  capturing.value = false;
  window.removeEventListener("keydown", capture, true);
}
function capture(event: KeyboardEvent) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.key === "Escape") {
    stop();
    message.value = "Shortcut change cancelled.";
    return;
  }
  if (event.key === "Backspace" || event.key === "Delete") {
    stop();
    props.data.saveShortcut(null);
    message.value = "";
    return;
  }
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/u.test(event.key);
  if (!functionKey && !event.metaKey && !event.ctrlKey && !event.altKey) return;
  if (event.key.length !== 1 && !functionKey) return;
  stop();
  props.data.saveShortcut(
    `${event.metaKey ? "⌘" : event.ctrlKey ? "Ctrl" : ""}${event.shiftKey ? "⇧" : ""}${event.altKey ? "⌥" : ""}${event.key.toUpperCase()}`,
  );
  message.value = "";
}
function begin() {
  capturing.value = true;
  message.value =
    "Press a key with Command, Control or Option; add Shift if needed. F1–F24 also work alone. Escape cancels; Delete clears.";
  window.addEventListener("keydown", capture, true);
}
function close(event: Event) {
  if (event.currentTarget instanceof HTMLDetailsElement) event.currentTarget.open = false;
}
onBeforeUnmount(stop);
</script>
<template>
  <h1>Shortcuts</h1>
  <div class="setting-group">
    <div class="setting-row">
      <span><strong>Hub</strong></span>
      <div class="shortcut-setting" aria-label="Hub shortcut">
        <span class="visually-hidden">Shortcut</span
        ><button
          class="secondary shortcut-value"
          :disabled="capturing"
          aria-label="Change Hub shortcut"
          @click="begin"
        >
          <span v-if="capturing">Press keys…</span
          ><span v-else-if="!state.shortcuts.hub">Not set</span
          ><span v-else class="shortcut-keycaps"
            ><kbd>{{ state.shortcuts.hub }}</kbd></span
          ><span aria-hidden="true">Change</span>
        </button>
        <details class="shortcut-options" @keydown.esc.prevent="close">
          <summary aria-label="Hub shortcut options" title="Shortcut options"><Ellipsis /></summary>
          <div class="shortcut-actions">
            <button
              class="text-link"
              :disabled="capturing || !state.shortcuts.hub"
              aria-label="Clear Hub shortcut"
              @click="data.saveShortcut(null)"
            >
              Clear</button
            ><button
              class="text-link"
              :disabled="capturing"
              aria-label="Restore Hub default shortcut"
              @click="data.saveShortcut('⌘R')"
            >
              Restore default
            </button>
          </div>
        </details>
        <p v-if="message" role="status" class="inline-message">{{ message }}</p>
      </div>
    </div>
  </div>
</template>

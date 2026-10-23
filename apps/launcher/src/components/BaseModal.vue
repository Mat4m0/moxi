<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
defineProps<{ labelledby: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement>();
let previous: HTMLElement | null = null;
let shell: HTMLElement | null = null;
function keys(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
  if (event.key !== "Tab") return;
  const items = [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary",
    ) ?? []),
  ].filter((item) => !item.closest("details:not([open])") || item.tagName === "SUMMARY");
  const first = items[0];
  const last = items.at(-1);
  if (!first) {
    event.preventDefault();
    dialog.value?.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
onMounted(async () => {
  previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  shell = document.querySelector(".app-shell");
  if (shell) shell.inert = true;
  await nextTick();
  (dialog.value?.querySelector<HTMLElement>("[autofocus], button, input") ?? dialog.value)?.focus();
});
onBeforeUnmount(() => {
  if (shell) shell.inert = false;
  previous?.focus();
});
</script>
<template>
  <Teleport to="body"
    ><div class="modal-backdrop" @pointerdown.self="emit('close')">
      <section
        ref="dialog"
        class="modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledby"
        tabindex="-1"
        @keydown="keys"
      >
        <slot />
      </section></div
  ></Teleport>
</template>

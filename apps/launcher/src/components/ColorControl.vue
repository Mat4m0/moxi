<script setup lang="ts">
import { ref, useId, watch } from "vue";
import type { UiColor } from "@moxi/ui";
const props = defineProps<{ label: string; value: string }>();
const emit = defineEmits<{ change: [value: UiColor] }>();
const draft = ref(props.value);
const error = ref("");
const errorId = useId();
watch(
  () => props.value,
  (value) => {
    draft.value = value;
    error.value = "";
  },
);
function commit(value: string) {
  const digits = value.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/u.test(digits)) {
    error.value = "Enter six hex digits, for example #e8b75c.";
    return;
  }
  const color: UiColor = `#${digits}`;
  draft.value = color;
  error.value = "";
  emit("change", color);
}
function picker(event: Event) {
  if (event.currentTarget instanceof HTMLInputElement) commit(event.currentTarget.value);
}
function blur(event: Event) {
  if (event.currentTarget instanceof HTMLInputElement) event.currentTarget.blur();
}
</script>
<template>
  <div class="color-control">
    <input
      class="color-swatch"
      type="color"
      :aria-label="`${label} picker`"
      :value="value"
      @change="picker"
    /><input
      v-model="draft"
      class="color-hex"
      type="text"
      :aria-label="`${label} hex`"
      :aria-invalid="!!error"
      :aria-describedby="error ? errorId : undefined"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      @change="commit(draft)"
      @keydown.enter.prevent="blur"
      @keydown.esc.prevent="
        draft = value;
        error = '';
      "
    /><small v-if="error" :id="errorId" role="alert" class="control-error">{{ error }}</small>
  </div>
</template>

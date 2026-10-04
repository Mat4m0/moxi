<script setup lang="ts">
import { ref, useId, watch } from "vue";
const props = defineProps<{
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
}>();
const emit = defineEmits<{ change: [value: number] }>();
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
function preview(event: Event) {
  if (event.currentTarget instanceof HTMLInputElement)
    draft.value = event.currentTarget.valueAsNumber;
}
function commit(event: Event) {
  if (!(event.currentTarget instanceof HTMLInputElement)) return;
  const number = event.currentTarget.valueAsNumber;
  if (!Number.isInteger(number) || number < props.min || number > props.max) {
    error.value = `Enter a whole number from ${props.min} to ${props.max}.`;
    return;
  }
  draft.value = number;
  error.value = "";
  emit("change", number);
}
</script>
<template>
  <div class="range-control">
    <input
      type="range"
      :aria-label="label"
      :min="min"
      :max="max"
      step="1"
      :value="draft"
      :aria-valuetext="`${draft}${unit ?? ''}`"
      @input="preview"
      @change="commit"
    />
    <div class="range-value">
      <input
        type="number"
        :aria-label="`${label} value`"
        :min="min"
        :max="max"
        step="1"
        :value="draft"
        :aria-invalid="!!error"
        :aria-describedby="error ? errorId : undefined"
        @change="commit"
      /><span v-if="unit" aria-hidden="true">{{ unit }}</span>
    </div>
    <small v-if="error" :id="errorId" role="alert" class="control-error">{{ error }}</small>
  </div>
</template>

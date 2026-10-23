<script setup lang="ts">
import { Play, RotateCcw } from "lucide-vue-next";
import type { Account, Readiness } from "../launcher-data";

defineProps<{ account: Account; readiness: Readiness; busy?: boolean }>();
const emit = defineEmits<{ play: [id: string] }>();
</script>
<template>
  <button
    v-if="account.state === 'running'"
    class="profile-action"
    :disabled="busy || readiness.state === 'preparing'"
    :aria-label="`Show ${account.name}`"
    @click="emit('play', account.id)"
  >
    Show
  </button>
  <button
    v-else
    class="profile-action"
    :disabled="busy || readiness.state === 'preparing'"
    :aria-label="`${readiness.state === 'repair-required' ? 'Repair game files for' : account.state === 'failed' ? 'Try again for' : 'Play'} ${account.name}`"
    @click="emit('play', account.id)"
  >
    <RotateCcw
      v-if="account.state === 'failed' || readiness.state === 'repair-required'"
      aria-hidden="true"
    /><Play v-else aria-hidden="true" />{{
      readiness.state === "repair-required"
        ? "Repair"
        : account.state === "failed"
          ? "Try again"
          : "Play"
    }}
  </button>
</template>

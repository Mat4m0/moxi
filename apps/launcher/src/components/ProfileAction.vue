<script setup lang="ts">
import { Clock3, Play, RotateCcw, X } from "lucide-vue-next";
import type { Profile, Readiness } from "../launcher-data";
import { profileStatus } from "../launcher-view-model";

defineProps<{ profile: Profile; readiness: Readiness; busy?: boolean }>();
const emit = defineEmits<{ play: [id: string]; cancel: [id: string] }>();
</script>
<template>
  <button
    v-if="profile.state === 'running'"
    class="profile-action"
    :disabled="busy"
    :aria-label="`Show ${profile.name}`"
    @click="emit('play', profile.id)"
  >
    Show
  </button>
  <button
    v-else-if="profile.state === 'ready' || profile.state === 'failed'"
    class="profile-action"
    :disabled="busy"
    :aria-label="`${readiness.state === 'repair-required' ? 'Repair game files for' : profile.state === 'failed' ? 'Try again for' : 'Play'} ${profile.name}`"
    @click="emit('play', profile.id)"
  >
    <RotateCcw
      v-if="profile.state === 'failed' || readiness.state === 'repair-required'"
      aria-hidden="true"
    /><Play v-else aria-hidden="true" />{{
      readiness.state === "repair-required"
        ? "Repair"
        : profile.state === "failed"
          ? "Try again"
          : "Play"
    }}
  </button>
  <button
    v-else-if="profile.state === 'queued'"
    class="profile-action"
    :aria-label="`Cancel waiting for ${profile.name}`"
    @click="emit('cancel', profile.id)"
  >
    <X aria-hidden="true" />Cancel
  </button>
  <button
    v-else
    class="profile-action profile-waiting"
    disabled
    :aria-label="`${profile.name}: ${profileStatus(profile)}`"
  >
    <Clock3 aria-hidden="true" />Opening
  </button>
</template>

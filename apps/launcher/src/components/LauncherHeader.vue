<script setup lang="ts">
import { Settings, Users } from "lucide-vue-next";
import type { LauncherRoute } from "../launcher-data";

defineProps<{ route: LauncherRoute; productName: string; version: string }>();
const emit = defineEmits<{ navigate: [route: LauncherRoute] }>();
</script>
<template>
  <header class="titlebar">
    <button class="brand" aria-label="Accounts" @click="emit('navigate', 'accounts')">
      <span class="profile-copy"
        ><b role="heading" aria-level="1">{{ productName }}</b
        ><small>Version {{ version }}</small></span
      >
    </button>
    <nav aria-label="Main navigation">
      <button
        :class="{ active: route === 'accounts' }"
        :aria-current="route === 'accounts' ? 'page' : undefined"
        @click="emit('navigate', 'accounts')"
      >
        <Users />Accounts
      </button>
      <button
        :class="{ active: route === 'settings' }"
        :aria-current="route === 'settings' ? 'page' : undefined"
        @click="emit('navigate', 'settings')"
      >
        <Settings />Settings
      </button>
    </nav>
  </header>
</template>

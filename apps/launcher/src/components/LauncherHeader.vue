<script setup lang="ts">
import { Home, Settings, Users } from "lucide-vue-next";
import type { LauncherRoute } from "../launcher-data";
import logo from "../assets/reforged-logo.webp";

defineProps<{ route: LauncherRoute; productName: string; version: string; embedded: boolean }>();
const emit = defineEmits<{ navigate: [route: LauncherRoute] }>();
</script>
<template>
  <header class="titlebar">
    <button class="brand" aria-label="Home" @click="emit('navigate', 'home')">
      <span v-if="embedded" class="profile-copy"
        ><b role="heading" aria-level="1">{{ productName }}</b
        ><small>Version {{ version }}</small></span
      >
      <img v-else :src="logo" alt="Guild Wars Reforged" />
    </button>
    <nav aria-label="Main navigation">
      <button
        :class="{ active: route === 'home' }"
        :aria-current="route === 'home' ? 'page' : undefined"
        @click="emit('navigate', 'home')"
      >
        <Home />Home
      </button>
      <button
        :class="{ active: route === 'accounts' }"
        :aria-current="route === 'accounts' ? 'page' : undefined"
        @click="emit('navigate', 'accounts')"
      >
        <Users />Accounts
      </button>
    </nav>
    <div class="title-actions">
      <button class="icon-button" aria-label="Settings" @click="emit('navigate', 'settings')">
        <Settings />
      </button>
    </div>
  </header>
</template>

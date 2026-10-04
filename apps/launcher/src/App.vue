<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { AlertTriangle } from "lucide-vue-next";
import type { LauncherData, LauncherRoute, Profile, SettingsRoute } from "./launcher-data";
import AccountsView from "./components/AccountsView.vue";
import AccountEditor from "./components/AccountEditor.vue";
import AppearanceSettings from "./components/AppearanceSettings.vue";
import GameFilesSettings from "./components/GameFilesSettings.vue";
import GeneralUpdateSettings from "./components/GeneralUpdateSettings.vue";
import HomeView from "./components/HomeView.vue";
import LauncherHeader from "./components/LauncherHeader.vue";
import LaunchBar from "./components/LaunchBar.vue";
import ShortcutSetting from "./components/ShortcutSetting.vue";
const props = defineProps<{ data: LauncherData; embedded?: boolean }>();
const state = props.data.state;
const ready = ref(false);
const startupError = ref(false);
const error = ref("");
const busy = ref(false);
const route = ref<LauncherRoute>("home");
const panel = ref<SettingsRoute>("general");
const editing = ref<{ profile: Profile | null } | null>(null);
const content = ref<HTMLElement>();
const groups = [
  {
    label: "Launcher",
    items: [
      { id: "general", label: "Updates" },
      { id: "shortcuts", label: "Shortcuts" },
    ],
  },
  {
    label: "Game",
    items: [
      { id: "appearance", label: "Appearance" },
      { id: "game-files", label: "Game files" },
    ],
  },
] as const;
async function initialize() {
  startupError.value = false;
  try {
    await props.data.initialize();
    ready.value = true;
  } catch {
    startupError.value = true;
  }
}
onMounted(initialize);
async function settings(section: SettingsRoute) {
  panel.value = section;
  route.value = "settings";
  await nextTick();
  if (content.value) {
    content.value.scrollTop = 0;
    const heading = content.value.querySelector<HTMLElement>("h1, h2");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }
}
async function play(id?: string) {
  if (busy.value) return;
  if (state.value.readiness.state === "repair-required") {
    await settings("game-files");
    return;
  }
  const ids = id ? [id] : state.value.selectedProfileIds;
  const profiles = state.value.profiles.filter(
    (profile) => ids.includes(profile.id) && !profile.archived,
  );
  if (
    !profiles.length ||
    profiles.some((profile) => ["opening", "checking"].includes(profile.state))
  )
    return;
  if (profiles.some((profile) => profile.state === "queued")) {
    for (const profile of profiles) props.data.cancel(profile.id);
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await props.data.play(
      profiles
        .filter((profile) => profile.state !== "running" || profiles.length === 1)
        .map((profile) => profile.id),
    );
  } catch {
    error.value = "Guild Wars could not be opened. Your account data was not changed. Try again.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div v-if="startupError" class="launcher-boot launcher-error" role="alert">
    <AlertTriangle />
    <h1>The launcher could not open</h1>
    <p>Your accounts and game files were not changed.</p>
    <button class="primary" @click="initialize">Try again</button>
  </div>
  <div v-else-if="!ready" class="launcher-boot" role="status">Opening launcher…</div>
  <div
    v-else
    class="app-shell"
    :class="{ 'accounts-shell': route === 'accounts', 'settings-shell': route === 'settings' }"
  >
    <LauncherHeader
      :route="route"
      :product-name="state.productName"
      :version="state.version"
      :embedded="!!embedded"
      @navigate="route = $event"
    />
    <main>
      <HomeView v-if="route === 'home'" :data="data" /><AccountsView
        v-else-if="route === 'accounts'"
        :data="data"
        :busy="busy"
        @edit="editing = { profile: $event }"
        @play="play"
      />
      <section v-else class="settings-page">
        <aside aria-label="Settings sections">
          <h2>Settings</h2>
          <div
            v-for="group in groups"
            :key="group.label"
            class="settings-nav-group"
            role="group"
            :aria-label="group.label"
          >
            <h3>{{ group.label }}</h3>
            <button
              v-for="item in group.items"
              :key="item.id"
              :aria-current="panel === item.id ? 'page' : undefined"
              :class="{ active: panel === item.id }"
              @click="settings(item.id)"
            >
              {{ item.label }}
            </button>
          </div>
        </aside>
        <div ref="content" class="settings-content">
          <fieldset class="settings-fields">
            <legend class="visually-hidden">Settings for every account</legend>
            <GeneralUpdateSettings v-if="panel === 'general'" :data="data" /><AppearanceSettings
              v-else-if="panel === 'appearance'"
              :data="data"
            /><GameFilesSettings v-else-if="panel === 'game-files'" :data="data" /><ShortcutSetting
              v-else
              :data="data"
            />
          </fieldset>
        </div>
      </section>
    </main>
    <LaunchBar
      :data="data"
      :busy="busy"
      :error="error"
      :viewing-game-files="route === 'settings' && panel === 'game-files'"
      @play="play"
      @manage="route = 'accounts'"
      @game-files="settings('game-files')"
      @dismiss="error = ''"
    />
    <AccountEditor v-if="editing" :data="data" :profile="editing.profile" @close="editing = null" />
  </div>
</template>

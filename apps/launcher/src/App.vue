<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { AlertTriangle } from "lucide-vue-next";
import type { Account, LauncherData, LauncherRoute, SettingsRoute } from "./launcher-data";
import AccountsView from "./components/AccountsView.vue";
import AccountEditor from "./components/AccountEditor.vue";
import GameFilesSettings from "./components/GameFilesSettings.vue";
import LauncherHeader from "./components/LauncherHeader.vue";
import ReadinessBar from "./components/ReadinessBar.vue";
import ToolsSettings from "./components/ToolsSettings.vue";
const props = defineProps<{ data: LauncherData }>();
const state = props.data.state;
const ready = ref(false);
const startupError = ref(false);
const error = ref("");
const busy = ref(false);
const route = ref<LauncherRoute>("accounts");
const panel = ref<SettingsRoute>("tools");
const editing = ref<{ account: Account | null } | null>(null);
const marked = computed(() =>
  state.value.accounts.filter((account) => !account.archived && account.selected),
);
const content = ref<HTMLElement>();
const sections = [
  { id: "tools", label: "Tools" },
  { id: "game-files", label: "Game files" },
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
// Main brings the launcher back at Accounts when the Accounts menu cannot open an account.
props.data.onNavigate(() => {
  route.value = "accounts";
});
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
async function play(ids: readonly string[]) {
  if (busy.value || state.value.readiness.state === "preparing") return false;
  if (state.value.readiness.state === "repair-required") {
    await settings("game-files");
    return false;
  }
  busy.value = true;
  error.value = "";
  try {
    await props.data.play(ids);
    return true;
  } catch {
    error.value = "Guild Wars could not be opened. Your account data was not changed. Try again.";
    return false;
  } finally {
    busy.value = false;
  }
}
// Several marked accounts start the closed ones; with none closed, the first one is shown.
async function playSelected() {
  const [first] = marked.value;
  if (!first) return;
  const closed = marked.value.filter((account) => account.state !== "running");
  const ids = marked.value.length === 1 || !closed.length ? [first.id] : closed.map((a) => a.id);
  await play(ids);
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
  <div v-else class="app-shell">
    <LauncherHeader
      :route="route"
      :product-name="state.productName"
      :version="state.version"
      @navigate="route = $event"
    />
    <main>
      <AccountsView
        v-if="route === 'accounts'"
        :data="data"
        :busy="busy"
        @edit="editing = { account: $event }"
        @play="play([$event])"
        @play-selected="playSelected"
      />
      <section v-else class="settings-page">
        <aside aria-label="Settings sections">
          <h2>Settings</h2>
          <div class="settings-nav-group">
            <button
              v-for="item in sections"
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
            <ToolsSettings v-if="panel === 'tools'" :data="data" /><GameFilesSettings
              v-else
              :data="data"
            />
          </fieldset>
        </div>
      </section>
    </main>
    <ReadinessBar
      :data="data"
      :error="error"
      @game-files="settings('game-files')"
      @dismiss="error = ''"
    />
    <AccountEditor v-if="editing" :data="data" :account="editing.account" @close="editing = null" />
  </div>
</template>

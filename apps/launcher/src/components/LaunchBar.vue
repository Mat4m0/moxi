<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  Play,
  RotateCcw,
  Settings,
  Users,
  WifiOff,
  X,
} from "lucide-vue-next";
import type { LauncherData } from "../launcher-data";
import { launchLabel, profileStatus } from "../launcher-view-model";
import ProfileAction from "./ProfileAction.vue";
const props = defineProps<{
  data: LauncherData;
  busy: boolean;
  error: string;
  viewingGameFiles: boolean;
}>();
const emit = defineEmits<{ play: [id?: string]; manage: []; gameFiles: []; dismiss: [] }>();
const state = props.data.state;
const open = ref(false);
const updateDismissed = ref(false);
const wrap = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const visible = computed(() => state.value.profiles.filter((profile) => !profile.archived));
const selected = computed(() =>
  visible.value.filter((profile) => state.value.selectedProfileIds.includes(profile.id)),
);
const summary = computed(() =>
  selected.value.length === 1 ? selected.value[0]!.name : `${selected.value.length} selected`,
);
const label = computed(() => launchLabel(selected.value, state.value.readiness));
const disabled = computed(
  () =>
    props.busy ||
    !selected.value.length ||
    selected.value.some((profile) => ["opening", "checking"].includes(profile.state)) ||
    (state.value.readiness.state !== "repair-required" &&
      selected.value.length > 1 &&
      selected.value.every((profile) => profile.state === "running")),
);
const status = computed(() => {
  if (props.error)
    return {
      title: props.error,
      detail: "Nothing was changed.",
      tone: "danger",
      icon: AlertTriangle,
    };
  const readiness = state.value.readiness;
  if (readiness.state === "repair-required")
    return {
      title: "Game files need repair",
      detail: "Guild Wars cannot start until the game files are ready.",
      tone: "danger",
      icon: AlertTriangle,
    };
  if (readiness.state === "offline-playable")
    return {
      title: "Ready to play offline",
      detail: "Using the game files already on this Mac.",
      tone: "warning",
      icon: WifiOff,
    };
  if (readiness.state === "preparing")
    return {
      title: `Preparing Guild Wars · ${Math.min(100, Math.round((readiness.progress.received / readiness.progress.total) * 100))}%`,
      detail: "Downloading the playable client",
      tone: "working",
      icon: Clock3,
      action: "View download",
      progress: Math.min(
        100,
        Math.round((readiness.progress.received / readiness.progress.total) * 100),
      ),
    };
  if (state.value.appUpdate.phase === "ready" && !updateDismissed.value)
    return {
      title: "Launcher update ready",
      detail: "Restart when you are finished playing.",
      tone: "working",
      icon: RotateCcw,
      action: "Restart and update",
      update: true,
    };
  const download = readiness.backgroundDownload;
  if (download?.status === "running") {
    const progress = Math.min(100, Math.round((download.received / download.total) * 100));
    return {
      title: "Downloading game files",
      detail: `${progress}% complete. You can play while this downloads.`,
      tone: "working",
      icon: Clock3,
      progress,
      action: "View download",
    };
  }
  if (download?.status === "paused")
    return {
      title: "Game file download paused",
      detail: "You can play now and resume the offline files when you are ready.",
      tone: "working",
      icon: Clock3,
      action: "View download",
    };
  return { title: "Ready to play", detail: "Guild Wars is available.", tone: "ready", icon: Check };
});
async function togglePicker() {
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    wrap.value
      ?.querySelector<HTMLElement>(
        '[role="checkbox"]:not(:disabled), .profile-action:not(:disabled)',
      )
      ?.focus();
  }
}
function outside(event: Event) {
  if (event.target instanceof Node && !wrap.value?.contains(event.target)) open.value = false;
}
async function escape(event: KeyboardEvent) {
  if (!open.value || event.key !== "Escape") return;
  event.preventDefault();
  open.value = false;
  await nextTick();
  trigger.value?.focus();
}
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", outside);
  document.addEventListener("keydown", escape);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("focusin", outside);
  document.removeEventListener("keydown", escape);
});
function play(id: string) {
  if (state.value.readiness.state === "repair-required") open.value = false;
  emit("play", id);
}
</script>
<template>
  <footer class="launchbar">
    <div
      class="readiness"
      :class="`status-${status.tone}`"
      :role="status.tone === 'danger' ? 'alert' : 'status'"
      :aria-live="status.tone === 'danger' ? 'assertive' : 'polite'"
    >
      <span class="status-icon" aria-hidden="true"><component :is="status.icon" /></span>
      <div class="status-copy">
        <strong>{{ status.title }}</strong
        ><small>{{ status.detail }}</small
        ><progress
          v-if="status.progress !== undefined"
          :value="status.progress"
          max="100"
          :aria-label="`${status.progress}% complete`"
        />
      </div>
      <div v-if="status.action || error" class="status-actions">
        <button v-if="status.update" class="status-quiet-action" @click="updateDismissed = true">
          Later
        </button>
        <button
          v-if="status.action"
          class="status-action"
          @click="status.update ? data.installUpdate() : emit('gameFiles')"
        >
          {{ status.action }}</button
        ><button
          v-if="error"
          class="icon-button"
          aria-label="Dismiss error"
          @click="emit('dismiss')"
        >
          <X />
        </button>
      </div>
    </div>
    <div ref="wrap" class="picker-wrap">
      <button
        ref="trigger"
        class="account-picker"
        :class="{ expanded: open }"
        :aria-label="`Choose accounts, ${summary}`"
        :aria-expanded="open"
        aria-controls="profile-picker"
        @click="togglePicker"
      >
        <Users /><span aria-hidden="true"
          ><small>Accounts</small><strong :title="summary">{{ summary }}</strong></span
        ><ChevronDown aria-hidden="true" />
      </button>
      <div
        v-if="open"
        id="profile-picker"
        class="profile-picker"
        role="group"
        aria-label="Choose accounts"
      >
        <div class="picker-heading">
          <strong>Accounts</strong><span>Select accounts to play together, or launch one.</span>
        </div>
        <div class="profile-list">
          <div
            v-for="profile in visible"
            :key="profile.id"
            class="profile-choice"
            :class="{ selected: state.selectedProfileIds.includes(profile.id) }"
          >
            <button
              class="profile-toggle"
              role="checkbox"
              :disabled="
                state.selectedProfileIds.length === 1 &&
                state.selectedProfileIds.includes(profile.id)
              "
              :title="
                state.selectedProfileIds.length === 1 &&
                state.selectedProfileIds.includes(profile.id)
                  ? 'Select another account before removing this one'
                  : undefined
              "
              :aria-checked="state.selectedProfileIds.includes(profile.id)"
              :aria-label="`Select ${profile.name}`"
              @click="data.toggle(profile.id)"
            >
              <span
                aria-hidden="true"
                class="checkbox"
                :class="{ checked: state.selectedProfileIds.includes(profile.id) }"
                ><Check v-if="state.selectedProfileIds.includes(profile.id)" /></span
              ><span class="profile-copy"
                ><b>{{ profile.name }}</b
                ><small
                  ><span
                    v-if="profile.state === 'running'"
                    class="profile-open-dot"
                    aria-hidden="true"
                  />{{ profileStatus(profile) }}</small
                ></span
              >
            </button>
            <ProfileAction
              :profile="profile"
              :readiness="state.readiness"
              :busy="busy"
              @play="play"
              @cancel="data.cancel"
            />
          </div>
        </div>
        <button
          class="manage"
          @click="
            open = false;
            emit('manage');
          "
        >
          <Settings />Manage accounts
        </button>
      </div>
    </div>
    <button
      v-if="!viewingGameFiles || state.readiness.state !== 'repair-required'"
      class="primary launch"
      :disabled="disabled"
      @click="emit('play')"
    >
      <X v-if="selected.some((profile) => profile.state === 'queued')" /><Play v-else />{{ label }}
    </button>
  </footer>
</template>

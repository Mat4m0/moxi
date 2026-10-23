<script setup lang="ts">
import { computed, ref } from "vue";
import { Pencil, Plus } from "lucide-vue-next";
import type { LauncherData, Profile } from "../launcher-data";
import { profileStatus } from "../launcher-view-model";
import { profileIcons } from "../profile-icons";
import ConfirmDelete from "./ConfirmDelete.vue";
import ProfileAction from "./ProfileAction.vue";
const props = defineProps<{ data: LauncherData; busy: boolean }>();
const emit = defineEmits<{ edit: [profile: Profile | null]; play: [id: string] }>();
const state = props.data.state;
const active = computed(() => state.value.profiles.filter((profile) => !profile.archived));
const deleting = ref<Profile | null>(null);
const failed = computed(() => active.value.filter((profile) => profile.state === "failed").length);
</script>
<template>
  <section class="page accounts-page">
    <div class="page-head">
      <div>
        <h1>Accounts</h1>
        <p>
          {{ active.length }} accounts ·
          {{ active.filter((profile) => profile.state === "running").length }} open<span
            v-if="failed"
          >
            · {{ failed }} need attention</span
          >
        </p>
      </div>
      <button class="secondary" @click="emit('edit', null)"><Plus />Add account</button>
    </div>
    <div class="accounts-list-heading">
      <span>Select accounts to open together.</span><span>Play or show one account</span>
    </div>
    <div class="account-cards">
      <article
        v-for="profile in active"
        :key="profile.id"
        class="account-card"
        :class="{ selected: state.selectedProfileIds.includes(profile.id) }"
      >
        <input
          class="account-select"
          type="checkbox"
          :disabled="
            state.selectedProfileIds.length === 1 && state.selectedProfileIds.includes(profile.id)
          "
          :title="
            state.selectedProfileIds.length === 1 && state.selectedProfileIds.includes(profile.id)
              ? 'Select another account before removing this one'
              : undefined
          "
          :checked="state.selectedProfileIds.includes(profile.id)"
          :aria-label="`Select ${profile.name}`"
          @change="data.toggle(profile.id)"
        />
        <div class="avatar" :style="{ background: profile.appearance.color }" aria-hidden="true">
          <component :is="profileIcons[profile.appearance.icon]" />
        </div>
        <div class="account-details">
          <h2>{{ profile.name }}</h2>
        </div>
        <p
          class="account-state"
          :class="{ failed: profile.state === 'failed' }"
          :role="['opening', 'checking'].includes(profile.state) ? 'status' : undefined"
        >
          <span class="status-dot" :class="profile.state" aria-hidden="true" />{{
            profileStatus(profile)
          }}
        </p>
        <div class="account-actions">
          <ProfileAction
            :profile="profile"
            :readiness="state.readiness"
            :busy="busy"
            @play="emit('play', $event)"
            @cancel="data.cancel"
          /><button
            class="account-appearance"
            :aria-label="`Edit ${profile.name}`"
            @click="emit('edit', profile)"
          >
            <Pencil aria-hidden="true" /><span>Edit</span>
          </button>
        </div>
      </article>
    </div>
    <details v-if="state.profiles.some((profile) => profile.archived)" class="archived-accounts">
      <summary>Archived accounts</summary>
      <article
        v-for="profile in state.profiles.filter((profile) => profile.archived)"
        :key="profile.id"
      >
        <span>{{ profile.name }}</span
        ><button class="secondary" @click="data.archive(profile.id, false)">Restore</button
        ><button class="danger-button" @click="deleting = profile">Delete permanently</button>
      </article>
    </details>
  </section>
  <ConfirmDelete
    v-if="deleting"
    :name="deleting.name"
    @cancel="deleting = null"
    @confirm="
      data.deleteAccount(deleting.id);
      deleting = null;
    "
  />
</template>

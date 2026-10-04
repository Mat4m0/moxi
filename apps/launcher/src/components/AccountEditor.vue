<script setup lang="ts">
import { computed, ref } from "vue";
import { Archive, X } from "lucide-vue-next";
import type { LauncherData, Profile, ProfileIcon } from "../launcher-data";
import { profileIcons } from "../profile-icons";
import BaseModal from "./BaseModal.vue";
import ColorControl from "./ColorControl.vue";
const props = defineProps<{ data: LauncherData; profile: Profile | null }>();
const emit = defineEmits<{ close: [] }>();
const name = ref(props.profile?.name ?? "");
const icon = ref<ProfileIcon>(props.profile?.appearance.icon ?? "swords");
const color = ref(props.profile?.appearance.color ?? "#9a6638");
const error = ref("");
const canArchive = computed(
  () =>
    props.profile &&
    props.profile.id !== props.data.state.value.profiles.find((profile) => !profile.archived)?.id &&
    ["ready", "failed"].includes(props.profile.state),
);
function save() {
  try {
    props.data.saveProfile({
      id: props.profile?.id ?? crypto.randomUUID(),
      name: name.value,
      appearance: { icon: icon.value, color: color.value },
    });
    emit("close");
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : "The account could not be added. Try another name or try again.";
  }
}
</script>
<template>
  <BaseModal labelledby="account-edit-title" @close="emit('close')"
    ><form @submit.prevent="save">
      <div class="modal-head">
        <h2 id="account-edit-title">{{ profile ? "Edit account" : "Add account" }}</h2>
        <button type="button" class="icon-button" aria-label="Close" @click="emit('close')">
          <X />
        </button>
      </div>
      <p>
        {{
          profile
            ? "Choose a name and appearance you can recognize at a glance."
            : "This opens another separate Guild Wars window. Sign-in stays inside the game."
        }}
      </p>
      <label
        >Name<input
          v-model="name"
          autofocus
          maxlength="48"
          :placeholder="profile ? undefined : 'Second account'"
          :aria-invalid="!!error"
          :aria-describedby="error ? 'account-edit-error' : undefined"
      /></label>
      <p v-if="error" id="account-edit-error" class="account-edit-error" role="alert">
        {{ error }}
      </p>
      <component :is="profile ? 'div' : 'details'"
        ><summary v-if="!profile">Appearance</summary>
        <fieldset class="icon-options">
          <legend>Icon</legend>
          <button
            v-for="(component, key) in profileIcons"
            :key="key"
            type="button"
            :aria-label="key"
            :aria-pressed="icon === key"
            :class="{ selected: icon === key }"
            @click="icon = key"
          >
            <component :is="component" />
          </button>
        </fieldset>
        <fieldset class="color-options">
          <legend>Color</legend>
          <button
            v-for="value in [
              '#9a6638',
              '#496b58',
              '#46658a',
              '#76558b',
              '#9a4f4f',
              '#76703c',
              '#4c777d',
              '#6f6258',
            ]"
            :key="value"
            type="button"
            :aria-label="`Use ${value}`"
            :aria-pressed="color === value"
            :class="{ selected: color === value }"
            :style="{ background: value }"
            @click="color = value"
          /><ColorControl
            label="Custom account color"
            :value="color"
            @change="color = $event"
          /></fieldset
      ></component>
      <div v-if="canArchive && profile" class="archive-account-row">
        <span
          ><strong>Archive account</strong
          ><small>Hide this account without deleting its data.</small></span
        ><button
          type="button"
          class="archive-button"
          @click="
            data.archive(profile.id, true);
            emit('close');
          "
        >
          <Archive />Archive
        </button>
      </div>
      <div class="form-actions">
        <button type="button" class="secondary" @click="emit('close')">Cancel</button
        ><button class="primary" :disabled="!name.trim()">
          {{ profile ? "Save changes" : "Add account" }}
        </button>
      </div>
    </form></BaseModal
  >
</template>

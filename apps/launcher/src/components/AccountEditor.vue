<script setup lang="ts">
import { computed, ref } from "vue";
import { Archive, Trash2, X } from "lucide-vue-next";
import type { Account, LauncherData } from "../launcher-data";
import BaseModal from "./BaseModal.vue";
import ConfirmDelete from "./ConfirmDelete.vue";
const props = defineProps<{ data: LauncherData; account: Account | null }>();
const emit = defineEmits<{ close: [] }>();
const name = ref(props.account?.name ?? "");
const error = ref("");
const confirming = ref(false);
// Main refuses to archive or delete the last account in use, and an open account must be
// closed first; the buttons are offered only when Main would accept them.
const others = computed(
  () =>
    props.data.state.value.accounts.filter(
      (account) => !account.archived && account.id !== props.account?.id,
    ).length,
);
const closed = computed(() => props.account !== null && props.account.state !== "running");
const canRemove = computed(() => closed.value && others.value > 0);
function archive() {
  if (!props.account) return;
  props.data.archive(props.account.id, true);
  emit("close");
}
function remove() {
  if (!props.account) return;
  props.data.deleteAccount(props.account.id);
  emit("close");
}
function save() {
  try {
    props.data.saveAccount({ id: props.account?.id ?? crypto.randomUUID(), name: name.value });
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
        <h2 id="account-edit-title">{{ account ? "Edit account" : "Add account" }}</h2>
        <button type="button" class="icon-button" aria-label="Close" @click="emit('close')">
          <X />
        </button>
      </div>
      <p>
        {{
          account
            ? "Choose a name you can recognize at a glance."
            : "This opens another separate Guild Wars window. Sign-in stays inside the game."
        }}
      </p>
      <label
        >Name<input
          v-model="name"
          autofocus
          maxlength="48"
          :placeholder="account ? undefined : 'Second account'"
          :aria-invalid="!!error"
          :aria-describedby="error ? 'account-edit-error' : undefined"
      /></label>
      <p v-if="error" id="account-edit-error" class="account-edit-error" role="alert">
        {{ error }}
      </p>
      <div v-if="canRemove" class="archive-account-row">
        <span
          ><strong>Archive account</strong
          ><small>Hide this account without deleting its data.</small></span
        ><button type="button" class="archive-button" @click="archive"><Archive />Archive</button>
      </div>
      <div v-if="canRemove" class="archive-account-row">
        <span
          ><strong>Delete account</strong
          ><small>Remove this account and its saved data for good.</small></span
        ><button type="button" class="danger-button" @click="confirming = true">
          <Trash2 />Delete
        </button>
      </div>
      <div class="form-actions">
        <button type="button" class="secondary" @click="emit('close')">Cancel</button
        ><button class="primary" :disabled="!name.trim()">
          {{ account ? "Save changes" : "Add account" }}
        </button>
      </div>
    </form></BaseModal
  ><ConfirmDelete
    v-if="confirming && account"
    :name="account.name"
    @cancel="confirming = false"
    @confirm="remove"
  />
</template>

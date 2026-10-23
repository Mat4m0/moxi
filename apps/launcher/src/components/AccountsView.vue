<script setup lang="ts">
import { computed, ref } from "vue";
import { Pencil, Plus } from "lucide-vue-next";
import type { Account, LauncherData } from "../launcher-data";
import { accountStatus } from "../launcher-view-model";
import AccountAction from "./AccountAction.vue";
import ConfirmDelete from "./ConfirmDelete.vue";
const props = defineProps<{ data: LauncherData; busy: boolean }>();
const emit = defineEmits<{
  edit: [account: Account | null];
  play: [id: string];
  playSelected: [];
}>();
const state = props.data.state;
const active = computed(() => state.value.accounts.filter((account) => !account.archived));
const archived = computed(() => state.value.accounts.filter((account) => account.archived));
const deleting = ref<Account | null>(null);
const failed = computed(() => active.value.filter((account) => account.state === "failed").length);
const marked = computed(() => active.value.filter((account) => account.selected).length);
const open = computed(() => active.value.filter((account) => account.state === "running").length);
</script>
<template>
  <section class="page accounts-page">
    <div class="page-head">
      <div>
        <h1>Accounts</h1>
        <p>
          {{ active.length }} accounts · {{ open }} open<span v-if="failed">
            · {{ failed }} need attention</span
          >
        </p>
      </div>
      <button class="secondary" @click="emit('edit', null)"><Plus />Add account</button>
    </div>
    <div class="account-cards">
      <article v-for="account in active" :key="account.id" class="account-card">
        <label class="account-details">
          <input
            type="checkbox"
            :checked="account.selected"
            :aria-label="`Select ${account.name}`"
            @change="data.select(account.id, ($event.target as HTMLInputElement).checked)"
          />
          <h2>{{ account.name }}</h2>
        </label>
        <p class="account-state" :class="{ failed: account.state === 'failed' }">
          <span class="status-dot" :class="account.state" aria-hidden="true" />{{
            accountStatus(account)
          }}
        </p>
        <div class="account-actions">
          <AccountAction
            :account="account"
            :readiness="state.readiness"
            :busy="busy"
            @play="emit('play', $event)"
          /><button
            class="account-appearance"
            :aria-label="`Edit ${account.name}`"
            @click="emit('edit', account)"
          >
            <Pencil aria-hidden="true" /><span>Edit</span>
          </button>
        </div>
      </article>
    </div>
    <div class="run-selected">
      <button
        class="primary"
        :disabled="!marked || busy || state.readiness.state === 'preparing'"
        @click="emit('playSelected')"
      >
        Play selected ({{ marked }})
      </button>
    </div>
    <details v-if="archived.length" class="archived-accounts">
      <summary>Archived accounts</summary>
      <article v-for="account in archived" :key="account.id">
        <span>{{ account.name }}</span
        ><button class="secondary" @click="data.archive(account.id, false)">Restore</button
        ><button class="danger-button" @click="deleting = account">Delete permanently</button>
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

<script setup lang="ts">
import BaseModal from "./BaseModal.vue";
defineProps<{ name: string }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
</script>
<template>
  <BaseModal labelledby="account-delete-title" @close="emit('cancel')"
    ><div class="confirm-delete">
      <h2 id="account-delete-title">Delete {{ name }}?</h2>
      <p>
        This permanently removes the account and everything the launcher saved for it. It cannot be
        undone.
      </p>
      <div class="form-actions">
        <button type="button" class="secondary" autofocus @click="emit('cancel')">Cancel</button
        ><button type="button" class="danger-button" @click="emit('confirm')">
          Delete account
        </button>
      </div>
    </div></BaseModal
  >
</template>

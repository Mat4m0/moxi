<script setup lang="ts">
import type { Block } from "@moxi/sdk";
defineProps<{ blocks: readonly Block[] }>();
</script>

<template>
  <div class="blocks">
    <template v-for="(b, i) in blocks" :key="i">
      <p v-if="b.type === 'text'" class="text" :data-tone="b.tone">{{ b.text }}</p>
      <div
        v-else-if="b.type === 'skillbar'"
        class="hub-skill-bar"
        role="list"
        aria-label="Skill bar"
      >
        <span
          v-for="(s, n) in b.skills"
          :key="n"
          role="listitem"
          class="hub-skill"
          :data-elite="s === b.elite && s !== 0"
          :title="s ? `Skill ${s}` : 'Empty slot'"
        >
          {{ n + 1 }}
        </span>
      </div>
      <dl v-else-if="b.type === 'meta'" class="meta">
        <template v-for="[label, value] in b.rows" :key="label">
          <dt>{{ label }}</dt>
          <dd>{{ value }}</dd>
        </template>
      </dl>
    </template>
  </div>
</template>

<style scoped>
.blocks {
  display: grid;
  gap: 14px;
}
.text {
  margin: 0;
  color: var(--ui-text);
  font-size: var(--ui-type-body-size);
  line-height: 1.5;
}
.text[data-tone="muted"] {
  color: var(--ui-text-muted);
}
.meta {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 14px;
  font-size: var(--ui-type-caption-size);
}
dt {
  color: var(--ui-text-muted);
}
dd {
  margin: 0;
  color: var(--ui-text);
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
</style>

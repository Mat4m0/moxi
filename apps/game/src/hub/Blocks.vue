<script setup lang="ts">
import type { Block } from "@moxi/sdk";
defineProps<{ blocks: readonly Block[] }>();
</script>

<template>
  <div class="blocks">
    <template v-for="(b, i) in blocks" :key="i">
      <p v-if="b.type === 'text'" class="text" :data-tone="b.tone">{{ b.text }}</p>
      <div v-else-if="b.type === 'skillbar'" class="skillbar" role="list" aria-label="Skill bar">
        <span
          v-for="(s, n) in b.skills"
          :key="n"
          role="listitem"
          class="slot"
          :class="{ elite: s === b.elite && s !== 0 }"
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
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.5;
}
.text[data-tone="muted"] {
  color: var(--text-3);
}
.skillbar {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.slot {
  aspect-ratio: 1;
  border-radius: 5px;
  display: grid;
  place-items: center;
  background: linear-gradient(160deg, var(--surface-3), var(--surface-2));
  box-shadow: inset 0 0 0 1px var(--line);
  color: var(--text-3);
  font: 500 10px var(--font-ui);
}
.slot.elite {
  box-shadow: inset 0 0 0 1.5px var(--gold);
  color: var(--gold);
}
.meta {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 14px;
  font-size: 12px;
}
dt {
  color: var(--text-3);
}
dd {
  margin: 0;
  color: var(--text-1);
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
</style>

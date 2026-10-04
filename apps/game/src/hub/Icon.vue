<script setup lang="ts">
import { computed } from "vue";
import type { Icon } from "@moxi/sdk";

const props = defineProps<{ icon?: Icon; size?: number }>();

const PROFESSIONS: Record<string, [string, string]> = {
  warrior: ["W", "#c9a227"],
  ranger: ["R", "#5d9b3a"],
  monk: ["Mo", "#5aa9d6"],
  necromancer: ["N", "#3f8f5c"],
  mesmer: ["Me", "#a55bc4"],
  elementalist: ["E", "#d0533e"],
  assassin: ["A", "#c75b8f"],
  ritualist: ["Rt", "#3fb3a8"],
  paragon: ["P", "#d9a441"],
  dervish: ["D", "#7f8fb0"],
};

// Minimal glyph set (24px grid, stroke icons).
const GLYPHS: Record<string, string> = {
  target: "M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8",
  book: "M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h9",
  plus: "M12 5v14M5 12h14",
  coins:
    "M8 7c0-1.7 2.7-3 6-3s6 1.3 6 3-2.7 3-6 3-6-1.3-6-3zM8 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7M4 13c0-1.3 1.6-2.4 4-2.8M4 13v4c0 1.7 2.7 3 6 3 1.7 0 3.2-.3 4.3-.9",
  bolt: "M13 3 5 14h6l-1 7 8-11h-6z",
  command: "M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z",
  dot: "M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
};

const prof = computed(() =>
  props.icon && "profession" in props.icon ? PROFESSIONS[props.icon.profession] : null,
);
const glyph = computed(() =>
  props.icon && "glyph" in props.icon
    ? (GLYPHS[props.icon.glyph] ?? GLYPHS.dot)
    : props.icon && "skill" in props.icon
      ? null
      : GLYPHS.command,
);
const px = computed(() => `${props.size ?? 20}px`);
</script>

<template>
  <span v-if="prof" class="prof" :style="{ background: prof[1], width: px, height: px }">{{
    prof[0]
  }}</span>
  <span
    v-else-if="icon && 'skill' in icon"
    class="skill"
    :style="{ width: px, height: px }"
    :title="`Skill ${icon.skill}`"
  />
  <svg
    v-else
    class="glyph"
    :width="size ?? 20"
    :height="size ?? 20"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      :d="glyph ?? ''"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.prof {
  display: inline-grid;
  place-items: center;
  border-radius: var(--ui-radius-sm);
  flex: none;
  font: 600 9.5px/1 var(--ui-font-interface);
  color: rgb(0 0 0 / 0.78);
  letter-spacing: -0.02em;
}
.skill {
  display: inline-block;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-well-fill);
  flex: none;
}
.glyph {
  flex: none;
  color: var(--ui-accent);
}
</style>

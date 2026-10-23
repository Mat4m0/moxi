<script setup lang="ts">
import type { AppearanceSettings, LauncherData } from "../launcher-data";
import RangeControl from "./RangeControl.vue";
const props = defineProps<{ data: LauncherData }>();
const state = props.data.state;
const styles: Record<AppearanceSettings["uiStyle"], string> = {
  classic: "Guild Wars",
  obsidian: "Modern",
};
const fonts: Record<AppearanceSettings["uiFont"], string> = {
  "guild-wars": "Guild Wars",
  inter: "Inter",
  system: "System",
  avenir: "Avenir",
  georgia: "Georgia",
  palatino: "Palatino",
};
// A select can only report one of its own options, so the value is looked up, not cast.
function pick<K extends string>(options: Record<K, string>, event: Event): K | undefined {
  const value = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : "";
  return (Object.keys(options) as K[]).find((key) => key === value);
}
function style(event: Event) {
  const uiStyle = pick(styles, event);
  if (uiStyle) void props.data.saveSettings({ uiStyle });
}
function font(event: Event) {
  const uiFont = pick(fonts, event);
  if (uiFont) void props.data.saveSettings({ uiFont });
}
</script>
<template>
  <h2 class="appearance-heading">In-game panels</h2>
  <p>
    Style, font, and opacity update moxi panels in every open game window. Guild Wars menus keep
    their own appearance.
  </p>
  <div class="setting-group">
    <label
      ><span><strong>Panel style</strong></span
      ><select :value="state.settings.uiStyle" @change="style">
        <option v-for="(label, value) in styles" :key="value" :value="value">{{ label }}</option>
      </select></label
    >
    <label
      ><span><strong>Panel font</strong></span
      ><select :value="state.settings.uiFont" @change="font">
        <option v-for="(label, value) in fonts" :key="value" :value="value">{{ label }}</option>
      </select></label
    >
    <div class="setting-row">
      <span><strong>Panel opacity</strong></span
      ><RangeControl
        label="Panel opacity"
        :value="state.settings.uiPanelOpacity"
        :min="65"
        :max="100"
        unit="%"
        @change="data.saveSettings({ uiPanelOpacity: $event })"
      />
    </div>
  </div>
</template>

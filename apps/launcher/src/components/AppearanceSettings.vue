<script setup lang="ts">
import { computed, ref } from "vue";
import {
  accessibleForeground,
  compositeColor,
  contrastRatio,
  defaultCustomUiTheme,
  type CustomUiTheme,
  type UiFont,
} from "@moxi/ui";
import { themeText, themeFromText } from "../theme";
import type { LauncherData } from "../launcher-data";
import ColorControl from "./ColorControl.vue";
import RangeControl from "./RangeControl.vue";
const props = defineProps<{ data: LauncherData }>();
const state = props.data.state;
const imported = ref("");
const message = ref("");
const shared = computed(() => themeText(state.value.settings.uiCustomTheme));
const adjusted = computed(() =>
  backgrounds.value.some(
    (background) =>
      contrastRatio(background, theme.value.text) < 4.5 ||
      contrastRatio(background, theme.value.mutedText) < 4.5,
  ),
);
async function importTheme() {
  const theme = themeFromText(imported.value);
  if (!theme) {
    message.value = "That theme text is not valid.";
    return;
  }
  try {
    await props.data.saveSettings({ uiStyle: "custom", uiCustomTheme: theme });
    imported.value = "";
    message.value = "";
  } catch {
    message.value = "Appearance could not be saved. Try again.";
  }
}
const fonts: Record<UiFont, string> = {
  "guild-wars": "Guild Wars",
  inter: "Inter",
  system: "System",
  avenir: "Avenir",
  georgia: "Georgia",
  palatino: "Palatino",
};
const colors = [
  { field: "window", label: "Window background" },
  { field: "titlebar", label: "Title bar" },
  { field: "surface", label: "Panel surface" },
  { field: "recessed", label: "Input background" },
  { field: "selected", label: "Selection" },
  { field: "accent", label: "Accent" },
  { field: "text", label: "Text" },
  { field: "mutedText", label: "Secondary text" },
  { field: "border", label: "Border" },
] as const;
const theme = computed(() =>
  state.value.settings.uiStyle === "custom"
    ? state.value.settings.uiCustomTheme
    : defaultCustomUiTheme(state.value.settings.uiStyle === "obsidian" ? "modern" : "classic"),
);
const backgrounds = computed(() => [
  compositeColor(theme.value.window, "#FFFFFF", state.value.settings.uiPanelOpacity / 100),
  compositeColor(theme.value.window, "#000000", state.value.settings.uiPanelOpacity / 100),
  theme.value.titlebar,
  theme.value.surface,
  theme.value.recessed,
]);
const ink = computed(() => accessibleForeground(theme.value.text, backgrounds.value));
const muted = computed(() => accessibleForeground(theme.value.mutedText, backgrounds.value));
const font = computed(
  () =>
    ({
      "guild-wars": "Palatino, serif",
      inter: "Inter, system-ui, sans-serif",
      system: "system-ui, sans-serif",
      avenir: "Avenir, sans-serif",
      georgia: "Georgia, serif",
      palatino: "Palatino, serif",
    })[state.value.settings.uiFont],
);
function style(event: Event) {
  if (!(event.currentTarget instanceof HTMLSelectElement)) return;
  const value = event.currentTarget.value;
  if (value === "classic" || value === "obsidian" || value === "custom")
    void props.data.saveSettings({ uiStyle: value });
}
function selectFont(event: Event) {
  if (!(event.currentTarget instanceof HTMLSelectElement)) return;
  const value = event.currentTarget.value;
  for (const font of ["guild-wars", "inter", "system", "avenir", "georgia", "palatino"] as const)
    if (value === font) void props.data.saveSettings({ uiFont: font });
}
function update(patch: Partial<CustomUiTheme>) {
  void props.data.saveSettings({
    uiCustomTheme: { ...state.value.settings.uiCustomTheme, ...patch },
  });
}
function material(event: Event) {
  if (
    event.currentTarget instanceof HTMLSelectElement &&
    (event.currentTarget.value === "classic" || event.currentTarget.value === "modern")
  )
    update({ material: event.currentTarget.value });
}
function gradient(event: Event) {
  if (event.currentTarget instanceof HTMLInputElement)
    update({ windowGradient: event.currentTarget.checked });
}
</script>
<template>
  <h2 class="appearance-heading">In-game panels</h2>
  <p>
    Style, font, and opacity update gwonmac panels in every open game window. Guild Wars menus keep
    their own appearance.
  </p>
  <div class="setting-group">
    <label
      ><span><strong>Panel style</strong></span
      ><select :value="state.settings.uiStyle" @change="style">
        <option value="classic">Guild Wars</option>
        <option value="obsidian">Modern</option>
        <option value="custom">Custom</option>
      </select></label
    >
    <label
      ><span><strong>Panel font</strong></span
      ><select :value="state.settings.uiFont" @change="selectFont">
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
    <figure class="panel-preview">
      <div
        class="panel-sample"
        :style="{
          background: theme.window,
          color: ink,
          borderColor: theme.border,
          fontFamily: font,
          opacity: state.settings.uiPanelOpacity / 100,
          borderRadius: theme.material === 'modern' ? '10px' : '2px',
        }"
        role="img"
        aria-label="Illustrative panel showing title, body text, selection, and input colors"
      >
        <div
          class="sample-title"
          :style="{
            background: theme.windowGradient
              ? `linear-gradient(${theme.titlebar}, ${theme.window})`
              : theme.titlebar,
            color: ink,
          }"
        >
          Build Library
        </div>
        <div class="sample-body" :style="{ background: theme.surface }">
          <span :style="{ color: muted }">Your saved builds</span>
          <div
            class="sample-selection"
            :style="{
              background: theme.selected,
              color: accessibleForeground(theme.text, [theme.selected]),
            }"
          >
            Ranger · Exploration
          </div>
          <div
            class="sample-input"
            :style="{ background: theme.recessed, color: muted, borderColor: theme.border }"
          >
            Search builds…
          </div>
          <strong :style="{ color: accessibleForeground(theme.accent, [theme.surface]) }"
            >View build</strong
          >
        </div>
      </div>
      <figcaption>
        Illustrative panel preview. Game lighting affects opacity; game fonts load in the game
        window.
      </figcaption>
    </figure>
    <p v-if="state.settings.uiStyle === 'custom' && adjusted" class="contrast-note" role="status">
      Some text colors have low contrast. Panels adjust text for readability while keeping your
      saved colors.
    </p>
    <template v-if="state.settings.uiStyle === 'custom'"
      ><label
        ><span><strong>Panel finish</strong></span
        ><select :value="state.settings.uiCustomTheme.material" @change="material">
          <option value="classic">Classic</option>
          <option value="modern">Modern flat</option>
        </select></label
      ><label
        ><span><strong>Window gradient</strong></span
        ><input
          type="checkbox"
          :checked="state.settings.uiCustomTheme.windowGradient"
          @change="gradient"
      /></label>
      <div class="setting-row">
        <span
          ><strong>Custom colors</strong
          ><small>Restore this palette without changing other settings.</small></span
        ><button
          class="secondary"
          @click="
            data.saveSettings({
              uiCustomTheme: { ...defaultCustomUiTheme(state.settings.uiCustomTheme.material) },
            })
          "
        >
          Restore default colors
        </button>
      </div>
      <div v-for="color in colors" :key="color.field" class="setting-row">
        <span>{{ color.label }}</span
        ><ColorControl
          :label="color.label"
          :value="state.settings.uiCustomTheme[color.field]"
          @change="update({ [color.field]: $event })"
        />
      </div>
      <details class="theme-sharing">
        <summary>Import or share a theme</summary>
        <label>Current theme<textarea :value="shared" readonly rows="3" /></label>
        <p>Select the text and press Command-C to copy it.</p>
        <label
          >Import theme<textarea
            v-model="imported"
            rows="3"
            placeholder="Paste theme text"
          /></label
        ><button class="secondary" :disabled="!imported.trim()" @click="importTheme">
          Import theme
        </button>
      </details>
    </template>
  </div>
  <p v-if="message" role="status" class="inline-message">{{ message }}</p>
</template>

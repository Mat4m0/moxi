<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { host, publishFacts, onGameAction, setEnabled, setSetting } from "../client.ts";
import { sim, tick, observe, performAction } from "./game-sim.ts";
import Hub from "../Hub.vue";
import { appearanceVariables } from "@moxi/ui";
import type { HudNode } from "@moxi/sdk";

onGameAction(performAction);
const uiStyle = ref<"classic" | "obsidian">("classic");
function applyAppearance(uiPanelOpacity = 94) {
  document.documentElement.dataset.uiStyle = uiStyle.value;
  for (const [key, value] of Object.entries(
    appearanceVariables({ uiStyle: uiStyle.value, uiFont: "guild-wars", uiPanelOpacity }),
  ))
    document.documentElement.style.setProperty(key, value);
}
applyAppearance();
const hubOpen = ref(false);
const gameKeys = ref(0); // key presses that reached "the game"
const heldFromHub = new Set<string>(); // keys pressed inside Hub; their repeats and releases never reach the game
const isMac = navigator.platform.toLowerCase().includes("mac");

function openHub() {
  hubOpen.value = true;
}
function closeHub() {
  hubOpen.value = false;
}

function onKeyDown(e: KeyboardEvent) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod && e.key.toLowerCase() === "r" && !e.shiftKey) {
    e.preventDefault();
    hubOpen.value = !hubOpen.value;
    heldFromHub.add(e.code);
    return;
  }
  if (hubOpen.value) {
    heldFromHub.add(e.code);
    return;
  } // the Hub has the keyboard
  if (heldFromHub.has(e.code)) {
    e.preventDefault();
    return;
  } // auto-repeat of a key that closed the Hub
  gameKeys.value++;
}
function onKeyUp(e: KeyboardEvent) {
  if (heldFromHub.delete(e.code)) e.preventDefault();
}

let raf = 0,
  last = performance.now(),
  lastPublish = 0;
function frame(now: number) {
  tick(now - last);
  last = now;
  if (now - lastPublish > 100) {
    publishFacts({ player: observe("player"), target: observe("target"), map: observe("map") });
    lastPublish = now;
  } // integration publishes at 10 Hz
  raf = requestAnimationFrame(frame);
}

onMounted(() => {
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  raf = requestAnimationFrame(frame);
});
onUnmounted(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("keyup", onKeyUp, true);
});

const hudNodes = computed(() =>
  Object.values(host.plugins).flatMap((p) => Object.values(p.hud).filter((n): n is HudNode => !!n)),
);
const targetScreen = computed(() => ({
  left: `${50 + (sim.target.x / 5000) * 46}%`,
  top: `${50 + (sim.target.y / 5000) * 46}%`,
}));
const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
</script>

<template>
  <div class="page">
    <main class="game" aria-label="Simulated game window">
      <div class="sky" />
      <div class="targetbar" v-if="sim.hasTarget && sim.mode !== 'loading'">
        <span class="tname">Mursaat Elementalist</span>
        <span class="hp"><span /></span>
      </div>
      <div class="hud" aria-live="off">
        <template v-for="(n, i) in hudNodes" :key="i">
          <div v-if="n.type === 'row'" class="hrow">
            <span
              v-for="(c, j) in n.children"
              :key="j"
              :class="[
                'htext',
                c.type === 'text' && `s-${c.size ?? 'm'}`,
                c.type === 'text' && `t-${c.tone ?? 'default'}`,
              ]"
              >{{ c.type === "text" ? c.text : "" }}</span
            >
          </div>
          <span
            v-else-if="n.type === 'text'"
            :class="['htext', `s-${n.size ?? 'm'}`, `t-${n.tone ?? 'default'}`]"
            >{{ n.text }}</span
          >
        </template>
      </div>
      <div class="compass" aria-hidden="true">
        <span class="ring cast" /><span class="me" />
        <span v-if="sim.hasTarget" class="foe" :style="targetScreen" />
      </div>
      <div v-if="sim.mode === 'loading'" class="loading">Loading…</div>
      <button class="open" @click="openHub">
        Open Hub <kbd>{{ isMac ? "⌘" : "Ctrl" }}</kbd
        ><kbd>R</kbd>
      </button>
      <div class="keys">
        Keys that reached the game: <b>{{ gameKeys }}</b>
      </div>
      <div class="toasts">
        <div v-for="t in host.toasts" :key="t.id" class="hub-receipt ui-well" :data-tone="t.tone">
          <b>{{ t.title }}</b
          ><span v-if="t.message">{{ t.message }}</span
          ><small>{{ t.plugin }}</small>
        </div>
      </div>
      <Hub v-if="hubOpen" @close="closeHub" />
    </main>

    <aside class="side">
      <h1>Plugin runtime probe</h1>
      <section>
        <h2>Game simulation</h2>
        <label
          >Theme
          <select v-model="uiStyle" aria-label="Theme" @change="applyAppearance(100)">
            <option value="classic">Classic</option>
            <option value="obsidian">Modern</option>
          </select>
        </label>
        <label
          >Integration
          <select v-model="sim.mode">
            <option value="ok">Supported build</option>
            <option value="unsupported">ArenaNet update: target unsupported</option>
            <option value="loading">Map loading</option>
          </select>
        </label>
        <label
          >Area
          <select v-model="sim.area">
            <option value="outpost">Outpost</option>
            <option value="explorable">Explorable</option>
            <option value="pvp">PvP</option>
          </select>
        </label>
        <label class="check"
          ><input type="checkbox" v-model="sim.hasTarget" /> Target selected</label
        >
        <label class="check"><input type="checkbox" v-model="sim.moving" /> Target moving</label>
      </section>
      <section>
        <h2>Plugins</h2>
        <div v-for="p in host.plugins" :key="p.manifest.id" class="plugin">
          <label class="check"
            ><input
              type="checkbox"
              :checked="p.enabled"
              @change="setEnabled(p.manifest.id, ($event.target as HTMLInputElement).checked)"
            />
            <b>{{ p.manifest.name }}</b></label
          >
          <span class="st" :data-s="p.status"
            >{{ p.status
            }}<template v-if="p.startMs !== undefined && p.status === 'running'">
              · started in {{ p.startMs }} ms</template
            ></span
          >
          <small
            >{{ (p.bytes / 1024).toFixed(1) }} KiB · {{ p.manifest.activation.join(", ") }} ·
            {{ p.manifest.permissions.join(", ") || "no permissions" }}</small
          >
          <small v-if="p.crashReason" class="err">{{ p.crashReason }}</small>
          <label v-for="s in p.manifest.settings ?? []" :key="s.key" class="check sub">
            <input
              type="checkbox"
              :checked="!!p.settings[s.key]"
              @change="
                setSetting(p.manifest.id, s.key, ($event.target as HTMLInputElement).checked)
              "
            />
            {{ s.label }}
          </label>
        </div>
      </section>
      <section>
        <h2>Game actions sent</h2>
        <ol class="log">
          <li v-for="a in host.gameActions" :key="a">{{ a }}</li>
          <li v-if="!host.gameActions.length" class="muted">None</li>
        </ol>
      </section>
      <section>
        <h2>Host decisions</h2>
        <ol class="log">
          <li v-for="l in host.log" :key="l.at + l.text" :data-tone="l.tone">
            {{ fmtTime(l.at) }} {{ l.text }}
          </li>
        </ol>
      </section>
    </aside>
  </div>
</template>

<style>
:root {
  --font-ui: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-game: "Palatino Linotype", Palatino, "Book Antiqua", serif;
  --surface-0: #17130f;
  --surface-1: #1e1914;
  --surface-2: #272019;
  --surface-3: #342b22;
  --line: rgb(255 236 210 / 0.09);
  --text-1: #f1e9df;
  --text-2: #c7b9a8;
  --text-3: #8f8273;
  --accent: #b84618;
  --accent-soft: rgb(184 70 24 / 0.2);
  --accent-text: #f0a37e;
  --gold: #d9b45a;
  --danger: #f07a6a;
  --danger-soft: rgb(240 122 106 / 0.14);
  --positive: #8cc77a;
}
* {
  box-sizing: border-box;
}
html,
body {
  margin: 0;
  height: 100%;
  background: #0d0b09;
  color: var(--text-1);
  font: 13px/1.45 var(--font-ui);
}
</style>

<style scoped>
.page {
  display: grid;
  grid-template-columns: 1fr 340px;
  height: 100vh;
}
.game {
  position: relative;
  overflow: hidden;
}
.sky {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 70% at 50% 110%, #3b2c1c 0%, transparent 60%),
    radial-gradient(80% 60% at 70% 20%, #2a3540 0%, transparent 70%),
    linear-gradient(#141a20, #1b1712 60%, #241b12);
}
.targetbar {
  position: absolute;
  top: 18px;
  left: 50%;
  translate: -50% 0;
  width: 300px;
  text-align: center;
  font-family: var(--font-game);
}
.tname {
  font-size: 15px;
  color: #f4d9c8;
  text-shadow: 0 1px 2px #000;
}
.hp {
  display: block;
  height: 10px;
  margin-top: 4px;
  background: #2b0d0a;
  box-shadow: 0 0 0 1px #000;
}
.hp span {
  display: block;
  width: 72%;
  height: 100%;
  background: linear-gradient(#c8392b, #8e1f16);
}
.hud {
  position: absolute;
  top: 64px;
  left: 50%;
  translate: -50% 0;
  display: grid;
  justify-items: center;
  gap: 4px;
  font-family: var(--font-game);
  text-shadow:
    0 1px 2px #000,
    0 0 8px rgb(0 0 0 / 0.6);
}
.hrow {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.htext.s-l {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
.htext.s-m {
  font-size: 15px;
}
.htext.s-s {
  font-size: 12px;
}
.t-accent {
  color: #ffd28a;
}
.t-muted {
  color: #b8aa98;
}
.t-default {
  color: #f1e9df;
}
.compass {
  position: absolute;
  right: 24px;
  bottom: 24px;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: rgb(10 12 14 / 0.7);
  box-shadow:
    0 0 0 2px #4a3b28,
    inset 0 0 20px #000;
}
.ring.cast {
  position: absolute;
  inset: calc(50% - 22.4%);
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgb(255 210 138 / 0.4);
}
.me {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 8px;
  height: 8px;
  translate: -50% -50%;
  border-radius: 50%;
  background: #7fd0ff;
}
.foe {
  position: absolute;
  width: 7px;
  height: 7px;
  translate: -50% -50%;
  border-radius: 50%;
  background: #ff5b4a;
}
.loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: #000;
  color: #b8aa98;
  font-family: var(--font-game);
  font-size: 20px;
}
.open {
  position: absolute;
  left: 20px;
  top: 18px;
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: rgb(30 25 20 / 0.85);
  color: var(--text-1);
  font: 500 12px var(--font-ui);
  cursor: pointer;
  box-shadow: 0 0 0 1px var(--line);
}
.keys {
  position: absolute;
  left: 20px;
  bottom: 18px;
  color: var(--text-3);
  font-size: 12px;
}
.keys b {
  color: var(--text-1);
}
kbd {
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  display: inline-grid;
  place-items: center;
  border-radius: 4px;
  background: var(--surface-3);
  color: var(--text-2);
  font: 500 11px var(--font-ui);
}
.toasts {
  position: absolute;
  left: 50%;
  bottom: 22px;
  translate: -50% 0;
  display: grid;
  gap: 8px;
  justify-items: center;
  z-index: 5;
}
.side {
  overflow-y: auto;
  padding: 18px;
  border-left: 1px solid var(--line);
  background: var(--surface-0);
}
h1 {
  margin: 0 0 14px;
  font: 600 15px var(--font-ui);
}
h2 {
  margin: 0 0 8px;
  font: 600 11px var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
}
section {
  margin-bottom: 20px;
  display: grid;
  gap: 8px;
}
label {
  display: grid;
  gap: 4px;
  color: var(--text-2);
}
label.check {
  display: flex;
  gap: 8px;
  align-items: center;
}
label.sub {
  padding-left: 22px;
  font-size: 12px;
}
select {
  height: 28px;
  border-radius: 7px;
  border: 0;
  background: var(--surface-2);
  color: var(--text-1);
  box-shadow: inset 0 0 0 1px var(--line);
  padding: 0 6px;
  font: inherit;
}
.plugin {
  display: grid;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 9px;
  background: var(--surface-1);
  box-shadow: inset 0 0 0 1px var(--line);
}
.st {
  font-size: 12px;
  color: var(--text-3);
}
.st[data-s="running"] {
  color: var(--positive);
}
.st[data-s="crashed"] {
  color: var(--danger);
}
small {
  color: var(--text-3);
  font-size: 11px;
}
.err {
  color: var(--danger);
}
.log {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: grid;
  gap: 3px;
  font-size: 12px;
  color: var(--text-2);
}
.log [data-tone="refused"] {
  color: var(--accent-text);
}
.log [data-tone="error"] {
  color: var(--danger);
}
.muted {
  color: var(--text-3);
}
</style>

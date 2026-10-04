<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { WireAction, WireItem, WireView } from "@moxi/sdk/host";
import {
  closeView,
  host,
  invoke,
  pushView,
  query as runQuery,
  runCommand,
  startHubPlugins,
  endHubSession,
  toast,
} from "./client.ts";
import { parseScope, rank } from "./search.ts";
import Blocks from "./Blocks.vue";
import Icon from "./Icon.vue";

const emit = defineEmits<{ close: [] }>();
const isMac = navigator.platform.toLowerCase().includes("mac");

type Row = {
  key: string;
  pluginId: string;
  surface: string;
  item: WireItem;
  kind: "command" | "item" | "result";
};
type Entry = {
  viewId: string | null;
  pluginId: string | null;
  query: string;
  selected: string | null;
};

const stack = ref<Entry[]>([{ viewId: null, pluginId: null, query: "", selected: null }]);
const top = computed(() => stack.value[stack.value.length - 1]);
const view = computed<WireView | null>(() =>
  top.value.viewId ? (host.views[top.value.viewId]?.view ?? null) : null,
);
const input = ref<HTMLInputElement>();
const root = ref<HTMLElement>();
const actionsOpen = ref(false);
const actionIndex = ref(0);
const confirming = ref<{ row: Row; action: WireAction } | null>(null);
const formValues = ref<Record<string, string | boolean>>({});
const followTop = ref(true); // until the player moves the selection, the top hit is selected

startHubPlugins();
const queryResults = ref<Record<string, WireItem[]>>({});

const scopes = computed(
  () =>
    new Set(
      Object.values(host.plugins).flatMap((p) => (p.enabled ? (p.manifest.scopes ?? []) : [])),
    ),
);
const parsed = computed(() => parseScope(top.value.query, scopes.value));

watch(
  [() => host.queryFor, () => host.queryResults, parsed],
  () => {
    if (host.queryFor?.text === parsed.value.text && host.queryFor.scope === parsed.value.scope)
      queryResults.value = host.queryResults;
  },
  { immediate: true },
);

const rootRows = computed<Row[]>(() => {
  const { scope, text } = parsed.value;
  const candidates: Row[] = [];
  for (const p of Object.values(host.plugins)) {
    if (!p.enabled) continue;
    const pid = p.manifest.id;
    if (!scope) {
      // Commands come from the manifest: listed without starting the plugin.
      for (const c of p.manifest.commands) {
        candidates.push({
          key: `cmd:${pid}:${c.id}`,
          pluginId: pid,
          surface: "command",
          kind: "command",
          item: {
            id: c.id,
            title: c.title,
            subtitle: c.subtitle ?? p.manifest.name,
            icon: c.icon ?? p.manifest.icon,
            keywords: c.keywords,
            actions: [{ id: "open", title: "Open Command", kind: "run" }],
          },
        });
      }
    }
    for (const item of p.items) {
      if (scope && item.scope !== scope) continue;
      candidates.push({
        key: `item:${pid}:${item.id}`,
        pluginId: pid,
        surface: "items",
        kind: "item",
        item,
      });
    }
  }
  const ranked = rank(
    candidates.map((r) => ({
      ...r,
      id: r.key,
      title: r.item.title,
      keywords: r.item.keywords,
      aliases: r.item.aliases,
    })),
    text,
  );
  const results: Row[] = scope
    ? []
    : Object.entries(queryResults.value).flatMap(([pid, items]) =>
        items.map((item) => ({
          key: `q:${pid}:${item.id}`,
          pluginId: pid,
          surface: "q",
          kind: "result" as const,
          item,
        })),
      );
  return [...results, ...ranked];
});

const rows = computed<Row[]>(() => {
  const e = top.value;
  if (!e.viewId) return rootRows.value;
  const v = view.value;
  if (!v || v.type !== "list") return [];
  const items = v.items.map((item) => ({
    key: item.id,
    pluginId: e.pluginId!,
    surface: e.viewId!,
    item,
    kind: "item" as const,
  }));
  return v.filter === "host"
    ? rank(
        items.map((r) => ({ ...r, id: r.key, title: r.item.title, keywords: r.item.keywords })),
        e.query,
      )
    : items;
});

// Rows that appeared very recently cannot be run by a double-click (the first
// click may have revealed them).
const firstSeen = new Map<string, number>();
watch(
  rows,
  (now) => {
    const t = performance.now();
    for (const key of firstSeen.keys()) if (!now.some((r) => r.key === key)) firstSeen.delete(key);
    for (const r of now) if (!firstSeen.has(r.key)) firstSeen.set(r.key, t);
    const e = top.value;
    if (followTop.value) e.selected = now[0]?.key ?? null;
    else if (e.selected && !now.some((r) => r.key === e.selected)) e.selected = null; // never run a replacement
  },
  { immediate: true },
);

let queryTimer: ReturnType<typeof setTimeout> | undefined;
watch([top, () => top.value.query], ([e, q], [previous]) => {
  if (e !== previous) return;
  followTop.value = true;
  e.selected = rows.value[0]?.key ?? null;
  if (!e.viewId) {
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => void runQuery(parsed.value.text, parsed.value.scope), 40);
  } else if (view.value?.type === "list" && view.value.filter === "plugin") {
    invoke(e.pluginId!, e.viewId, "$search", [q], false);
  }
});

const selectedRow = computed(() => rows.value.find((r) => r.key === top.value.selected) ?? null);
const detailActions = computed(() => (view.value?.type === "detail" ? view.value.actions : []));
const currentActions = computed<WireAction[]>(() =>
  view.value?.type === "detail" ? detailActions.value : (selectedRow.value?.item.actions ?? []),
);
const primary = computed(() => currentActions.value[0] ?? null);
const contextName = computed(() => {
  const pid = selectedRow.value?.pluginId ?? top.value.pluginId;
  return pid ? host.plugins[pid]?.manifest.name : "Hub";
});
const title = computed(() => (view.value ? view.value.title : null));
const placeholder = computed(() =>
  view.value?.type === "list"
    ? (view.value.placeholder ?? "Search…")
    : "Search builds, commands, or type 10 ecto in p…",
);

function focusInput() {
  input.value?.focus();
  void nextTick(() => input.value?.focus());
}
focusInput();

function push(entry: Entry) {
  stack.value.push(entry);
  followTop.value = true;
  focusInput();
}

function back() {
  const e = stack.value.pop()!;
  if (e.viewId) closeView(e.viewId);
  followTop.value = false; // restore the parent's query and selection as they were
  focusInput();
}

async function run(row: Row | null, action: WireAction, confirmed = false) {
  if (
    row &&
    !rows.value.some(
      (current) =>
        current.key === row.key && JSON.stringify(current.item) === JSON.stringify(row.item),
    )
  )
    return;
  if (action.confirm && !confirmed) {
    confirming.value = { row: row!, action };
    return;
  }
  confirming.value = null;
  actionsOpen.value = false;
  const e = top.value;
  if (action.kind === "copy") {
    await navigator.clipboard.writeText(action.copy ?? "").catch(() => undefined);
    toast("Hub", { title: "Copied to clipboard", tone: "positive" });
    return;
  }
  if (!row && e.viewId) {
    // detail view action
    if (action.kind === "push")
      push({
        viewId: pushView(e.pluginId!, e.viewId, `$detail/${action.id}`),
        pluginId: e.pluginId,
        query: "",
        selected: null,
      });
    else invoke(e.pluginId!, e.viewId, `$detail/${action.id}`);
    return;
  }
  if (!row) return;
  if (row.surface === "command") {
    const depth = stack.value.length;
    const viewId = await runCommand(row.pluginId, row.item.id);
    // A late command result must not navigate a Hub the player has moved on from.
    if (viewId && stack.value.length === depth && top.value === e)
      push({ viewId, pluginId: row.pluginId, query: "", selected: null });
    return;
  }
  if (action.kind === "push") {
    push({
      viewId: pushView(row.pluginId, row.surface, `${row.item.id}/${action.id}`),
      pluginId: row.pluginId,
      query: "",
      selected: null,
    });
    return;
  }
  invoke(row.pluginId, row.surface, `${row.item.id}/${action.id}`);
}

function submitForm() {
  const e = top.value;
  if (view.value?.type === "form" && e.viewId)
    invoke(e.pluginId!, e.viewId, "$submit", [{ ...formValues.value }]);
}

watch(view, (v) => {
  if (v?.type === "form")
    formValues.value = Object.fromEntries(
      v.fields.map((f) => [f.id, f.value ?? (f.type === "toggle" ? false : "")]),
    );
});

function matches(e: KeyboardEvent, shortcut?: string) {
  if (!shortcut) return false;
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.pop()!;
  const mod = parts.includes("mod");
  return (
    (isMac ? e.metaKey : e.ctrlKey) === mod &&
    e.shiftKey === parts.includes("shift") &&
    e.altKey === parts.includes("alt") &&
    e.key.toLowerCase() === key
  );
}

function move(delta: number) {
  const list = rows.value;
  if (!list.length) return;
  const i = list.findIndex((r) => r.key === top.value.selected);
  const next =
    i < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + delta));
  top.value.selected = list[next].key;
  followTop.value = false;
  void nextTick(() =>
    document
      .querySelector(`[data-key="${CSS.escape(list[next].key)}"]`)
      ?.scrollIntoView({ block: "nearest" }),
  );
}

function escape() {
  if (actionsOpen.value) {
    actionsOpen.value = false;
    return;
  }
  if (confirming.value) {
    confirming.value = null;
    return;
  }
  if (stack.value.length > 1) {
    back();
    return;
  }
  if (top.value.query) {
    top.value.query = "";
    return;
  }
  emit("close");
}

// While the Hub is open it owns the keyboard at window level, so a key never
// depends on where focus happens to be (the audit's "focus on <body>" class).
const pressed = new Set<string>();
function onKeyUp(e: KeyboardEvent) {
  if (!pressed.delete(e.code)) return;
  e.stopImmediatePropagation();
  if (!root.value && !pressed.size) {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKeyUp, true);
  }
}
onMounted(() => {
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKeyUp, true);
});
onUnmounted(() => {
  if (!pressed.size) {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKeyUp, true);
  }
  clearTimeout(queryTimer);
  endHubSession();
});
watch(
  () => view.value?.type,
  (type) => {
    if (type === "form")
      void nextTick(() =>
        root.value?.querySelector<HTMLElement>(".form input, .form select")?.focus(),
      );
    else focusInput();
  },
);

function onKey(e: KeyboardEvent) {
  if (!root.value) {
    if (pressed.has(e.code)) e.stopImmediatePropagation();
    return;
  }
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (
    document.activeElement !== input.value &&
    e.key.length === 1 &&
    !mod &&
    view.value?.type !== "form"
  )
    focusInput(); // typing always reaches search
  pressed.add(e.code);
  e.stopImmediatePropagation(); // window listeners standing in for the game must not see Hub keys
  if (e.key === "Escape") {
    e.preventDefault();
    if (!e.repeat) escape();
    return;
  }
  if (confirming.value) {
    if (e.key === "Enter") {
      e.preventDefault();
      void run(confirming.value.row, confirming.value.action, true);
    }
    return;
  }
  if (actionsOpen.value) {
    const list = currentActions.value;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      actionIndex.value = Math.min(list.length - 1, actionIndex.value + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      actionIndex.value = Math.max(0, actionIndex.value - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const a = list[actionIndex.value];
      if (a) void run(selectedRow.value, a);
    } else if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      actionsOpen.value = false;
    }
    return;
  }
  if (mod && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (currentActions.value.length) {
      actionsOpen.value = true;
      actionIndex.value = 0;
    }
    return;
  }
  if (view.value?.type === "form") {
    if (e.key === "Enter" && (mod || (e.target as HTMLElement).tagName === "INPUT")) {
      e.preventDefault();
      submitForm();
    }
    return;
  }
  const hit = currentActions.value.find((a) => matches(e, a.shortcut));
  if (hit) {
    e.preventDefault();
    void run(selectedRow.value, hit);
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    move(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    move(-1);
  } else if (e.key === "Enter" && !e.repeat) {
    e.preventDefault();
    if (primary.value) void run(selectedRow.value, primary.value);
  } else if (e.key === "Backspace" && mod && stack.value.length > 1) {
    e.preventDefault();
    back();
  }
}

function hover(e: MouseEvent, key: string) {
  if (e.movementX || e.movementY) {
    top.value.selected = key;
    followTop.value = false;
  } // a resting pointer never changes selection
}

function dblclick(row: Row) {
  const seen = firstSeen.get(row.key) ?? Infinity;
  if (performance.now() - seen < 700) return; // the row appeared during this double-click
  if (top.value.selected === row.key && row.item.actions[0]) void run(row, row.item.actions[0]);
}

const keycap = (s?: string) =>
  s?.split("+").map(
    (k) =>
      ({
        mod: isMac ? "⌘" : "Ctrl",
        shift: "⇧",
        alt: isMac ? "⌥" : "Alt",
        backspace: "⌫",
        enter: "↵",
      })[k] ?? k.toUpperCase(),
  ) ?? [];
const preview = computed(() => selectedRow.value?.item.preview ?? null);
</script>

<template>
  <div class="scrim" @mousedown.self="emit('close')">
    <section ref="root" class="hub" role="dialog" aria-label="Hub">
      <header>
        <button v-if="stack.length > 1" class="back" aria-label="Back" @click="back">‹</button>
        <span v-if="title" class="crumb">{{ title }}</span>
        <span v-else-if="parsed.scope" class="crumb scope">{{ parsed.scope }}</span>
        <input
          v-if="view?.type !== 'form' && view?.type !== 'detail'"
          ref="input"
          v-model="top.query"
          :placeholder="placeholder"
          spellcheck="false"
          autocomplete="off"
          aria-label="Search"
        />
        <span v-else ref="input" tabindex="-1" class="spacer" />
      </header>

      <div class="body">
        <template v-if="view?.type === 'detail'">
          <div class="detail">
            <h2>{{ view.title }}</h2>
            <Blocks :blocks="view.blocks" />
          </div>
        </template>

        <form v-else-if="view?.type === 'form'" class="form" @submit.prevent="submitForm">
          <label v-for="(f, i) in view.fields" :key="f.id" class="field">
            <span>{{ f.label }}</span>
            <input
              v-if="f.type === 'text'"
              v-model="formValues[f.id] as string"
              :placeholder="f.placeholder"
              :autofocus="i === 0"
            />
            <select v-else-if="f.type === 'select'" v-model="formValues[f.id] as string">
              <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <input v-else type="checkbox" v-model="formValues[f.id] as boolean" />
          </label>
        </form>

        <template v-else>
          <ul class="list" role="listbox" :aria-activedescendant="top.selected ?? undefined">
            <li
              v-for="row in rows"
              :key="row.key"
              :data-key="row.key"
              :id="row.key"
              role="option"
              :aria-selected="row.key === top.selected"
              :class="{ selected: row.key === top.selected }"
              @mousemove="hover($event, row.key)"
              @click="
                top.selected = row.key;
                followTop = false;
                focusInput();
              "
              @dblclick="dblclick(row)"
            >
              <Icon :icon="row.item.icon" />
              <span class="title">{{ row.item.title }}</span>
              <span class="subtitle">{{ row.item.subtitle }}</span>
              <span class="acc">
                <span v-for="(a, i) in row.item.accessories ?? []" :key="i" class="tag">{{
                  "text" in a ? a.text : a.label
                }}</span>
                <span class="kind">{{
                  row.kind === "command"
                    ? "Command"
                    : row.kind === "result"
                      ? "Result"
                      : host.plugins[row.pluginId]?.manifest.name
                }}</span>
              </span>
            </li>
            <li v-if="!rows.length" class="empty">
              {{
                view?.type === "list" && view.empty && !top.query ? view.empty.title : "No matches"
              }}
            </li>
          </ul>
          <aside v-if="preview" class="preview"><Blocks :blocks="preview" /></aside>
        </template>
      </div>

      <footer>
        <span class="ctx">{{ contextName }}</span>
        <span class="grow" />
        <template v-if="view?.type === 'form'">
          <button class="primary" @click="submitForm">
            {{ view.submitTitle }} <kbd>{{ isMac ? "⌘" : "Ctrl" }}</kbd
            ><kbd>↵</kbd>
          </button>
        </template>
        <template v-else>
          <button v-if="primary" class="primary" @click="run(selectedRow, primary)">
            {{ primary.title }} <kbd>↵</kbd>
          </button>
          <span v-else class="hint">Select a result</span>
          <button
            v-if="currentActions.length > 1"
            class="actions"
            @click="
              actionsOpen = !actionsOpen;
              actionIndex = 0;
            "
          >
            Actions <kbd>{{ isMac ? "⌘" : "Ctrl" }}</kbd
            ><kbd>K</kbd>
          </button>
        </template>
      </footer>

      <div v-if="actionsOpen" class="panel" role="menu">
        <button
          v-for="(a, i) in currentActions"
          :key="a.id"
          role="menuitem"
          :class="{ active: i === actionIndex, danger: a.style === 'destructive' }"
          @mousemove="actionIndex = i"
          @click="run(selectedRow, a)"
        >
          <span>{{ a.title }}</span>
          <span class="keys"
            ><kbd v-for="k in i === 0 ? ['↵'] : keycap(a.shortcut)" :key="k">{{ k }}</kbd></span
          >
        </button>
      </div>

      <div
        v-if="confirming"
        class="confirm"
        role="alertdialog"
        :aria-label="confirming.action.confirm?.title"
      >
        <h3>{{ confirming.action.confirm?.title }}</h3>
        <p>{{ confirming.action.confirm?.message }}</p>
        <div class="row">
          <button @click="confirming = null">Cancel <kbd>Esc</kbd></button>
          <button class="danger" @click="run(confirming.row, confirming.action, true)">
            {{ confirming.action.confirm?.confirmLabel ?? "Confirm" }} <kbd>↵</kbd>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  display: grid;
  justify-items: center;
  align-items: start;
  padding-top: 12vh;
  background: rgb(0 0 0 / 0.18);
}
.hub {
  position: relative;
  width: min(760px, calc(100vw - 32px));
  height: 460px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-columns: minmax(0, 1fr);
  background: var(--surface-1);
  color: var(--text-1);
  border-radius: 14px;
  overflow: hidden;
  box-shadow:
    0 0 0 1px var(--line),
    0 24px 70px rgb(0 0 0 / 0.55);
  font: 13px/1.4 var(--font-ui);
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  height: 52px;
  border-bottom: 1px solid var(--line);
}
header input {
  flex: 1;
  background: none;
  border: 0;
  outline: 0;
  color: var(--text-1);
  font: 400 16px var(--font-ui);
}
header input::placeholder {
  color: var(--text-3);
}
.spacer {
  flex: 1;
  outline: none;
}
.back {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  border: 0;
  background: var(--surface-3);
  color: var(--text-1);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.crumb {
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--surface-3);
  color: var(--text-2);
  font-weight: 500;
  white-space: nowrap;
}
.crumb.scope {
  background: var(--accent-soft);
  color: var(--accent-text);
  text-transform: capitalize;
}
.body {
  display: flex;
  min-height: 0;
}
.list {
  flex: 1;
  margin: 0;
  padding: 6px;
  list-style: none;
  overflow-y: auto;
  min-width: 0;
}
.list li {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: default;
}
.list li.selected {
  background: var(--surface-3);
}
.title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 0 1 auto;
}
.subtitle {
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 0;
  min-width: 0;
}
.acc {
  display: flex;
  gap: 6px;
  align-items: center;
  flex: none;
}
.tag {
  font-size: 11px;
  color: var(--text-3);
  padding: 1px 6px;
  border-radius: 5px;
  box-shadow: inset 0 0 0 1px var(--line);
}
.kind {
  font-size: 11px;
  color: var(--text-3);
  min-width: 60px;
  text-align: right;
}
.empty {
  color: var(--text-3);
  justify-content: center;
  height: 120px !important;
}
.preview {
  width: 260px;
  flex: none;
  padding: 16px;
  border-left: 1px solid var(--line);
  overflow-y: auto;
}
.detail {
  padding: 18px 20px;
  overflow-y: auto;
  flex: 1;
}
.detail h2 {
  margin: 0 0 14px;
  font: 600 17px var(--font-ui);
}
.form {
  padding: 18px 20px;
  display: grid;
  gap: 12px;
  align-content: start;
  flex: 1;
}
.field {
  display: grid;
  grid-template-columns: 130px 1fr;
  align-items: center;
  gap: 12px;
  color: var(--text-2);
}
.field input:not([type="checkbox"]),
.field select {
  height: 30px;
  padding: 0 9px;
  border-radius: 7px;
  border: 0;
  background: var(--surface-2);
  color: var(--text-1);
  box-shadow: inset 0 0 0 1px var(--line);
  font: inherit;
  outline-offset: 0;
}
.field input:focus-visible,
.field select:focus-visible {
  outline: 2px solid var(--accent);
}
footer {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 10px 0 14px;
  border-top: 1px solid var(--line);
  background: var(--surface-0);
}
.ctx {
  color: var(--text-3);
  font-size: 12px;
}
.grow {
  flex: 1;
}
.hint {
  color: var(--text-3);
  font-size: 12px;
}
footer button,
.confirm button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: none;
  color: var(--text-1);
  font: 500 12px var(--font-ui);
  cursor: pointer;
}
footer button:hover,
.confirm button:hover {
  background: var(--surface-3);
}
footer .actions {
  color: var(--text-2);
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
.panel {
  position: absolute;
  right: 10px;
  bottom: 48px;
  width: 280px;
  padding: 6px;
  border-radius: 11px;
  background: var(--surface-2);
  box-shadow:
    0 0 0 1px var(--line),
    0 14px 40px rgb(0 0 0 / 0.5);
  display: grid;
  gap: 1px;
}
.panel button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: none;
  color: var(--text-1);
  font: 13px var(--font-ui);
  text-align: left;
}
.panel button.active {
  background: var(--surface-3);
}
.panel button.danger {
  color: var(--danger);
}
.keys {
  display: flex;
  gap: 3px;
}
.confirm {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  width: 340px;
  padding: 18px;
  border-radius: 12px;
  background: var(--surface-2);
  box-shadow:
    0 0 0 1px var(--line),
    0 20px 50px rgb(0 0 0 / 0.55);
}
.confirm h3 {
  margin: 0 0 6px;
  font: 600 14px var(--font-ui);
}
.confirm p {
  margin: 0 0 16px;
  color: var(--text-2);
}
.confirm .row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.confirm .danger {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>

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
import FrameArtwork from "./FrameArtwork.vue";
import "@moxi/ui/fonts.css";
import "@moxi/ui/tokens.css";
import "@moxi/ui/components.css";
import "./hub.css";

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
  <dialog
    open
    class="ui-modal ui-modal-layer hub-modal"
    aria-label="Hub"
    @mousedown.self="emit('close')"
  >
    <section ref="root" class="hub-panel ui-frame">
      <FrameArtwork />
      <header class="hub-heading ui-window-head">
        <button
          v-if="stack.length > 1"
          class="hub-back ui-button"
          data-variant="quiet"
          aria-label="Back"
          @click="back"
        >
          ←
        </button>
        <span class="hub-name">Hub</span>
        <nav class="hub-breadcrumbs" aria-label="Hub breadcrumb">
          <span class="hub-caption">{{ title ?? "Home" }}</span>
        </nav>
        <span class="hub-context">{{ contextName }}</span>
        <button
          class="ui-window-close hub-close"
          aria-label="Close Hub"
          title="Close Hub"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <div v-if="view?.type !== 'form' && view?.type !== 'detail'" class="hub-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m12 2 8 10-8 10L4 12 12 2Zm0 5v10M8 12h8" />
        </svg>
        <span v-if="parsed.scope" class="hub-scope">{{ parsed.scope }}</span>
        <input
          ref="input"
          v-model="top.query"
          :placeholder="placeholder"
          spellcheck="false"
          autocomplete="off"
          aria-label="Search"
        />
      </div>
      <span v-else ref="input" tabindex="-1" class="hub-caption" />

      <template v-if="view?.type === 'detail'">
        <div class="hub-view">
          <div class="hub-detail">
            <h2>{{ view.title }}</h2>
            <Blocks :blocks="view.blocks" />
          </div>
        </div>
      </template>

      <div v-else-if="view?.type === 'form'" class="hub-view">
        <form class="form hub-detail" @submit.prevent="submitForm">
          <label v-for="(f, i) in view.fields" :key="f.id" class="ui-field">
            <span>{{ f.label }}</span>
            <input
              v-if="f.type === 'text'"
              class="ui-input"
              v-model="formValues[f.id] as string"
              :placeholder="f.placeholder"
              :autofocus="i === 0"
            />
            <select
              class="ui-select"
              v-else-if="f.type === 'select'"
              v-model="formValues[f.id] as string"
            >
              <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <input v-else type="checkbox" v-model="formValues[f.id] as boolean" />
          </label>
        </form>
      </div>

      <template v-else>
        <div
          class="hub-results ui-scroll"
          role="listbox"
          :aria-activedescendant="top.selected ?? undefined"
        >
          <template v-for="(row, index) in rows" :key="row.key">
            <div
              v-if="index === 0 || rows[index - 1].kind !== row.kind"
              class="hub-group"
              role="presentation"
            >
              {{ row.kind === "command" ? "Commands" : "Tools" }}
            </div>
            <div
              class="hub-row"
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
              <span class="hub-icon"><Icon :icon="row.item.icon" /></span>
              <span class="hub-title">{{ row.item.title }}</span>
              <span class="hub-detail">{{ row.item.subtitle }}</span>
              <span class="hub-row-type">
                <span v-for="(a, i) in row.item.accessories ?? []" :key="i" class="ui-kbd">{{
                  "text" in a ? a.text : a.label
                }}</span>
                <span>{{
                  row.kind === "command"
                    ? "Command"
                    : row.kind === "result"
                      ? "Result"
                      : host.plugins[row.pluginId]?.manifest.name
                }}</span>
              </span>
            </div>
          </template>
          <div v-if="!rows.length" class="hub-empty">
            {{
              view?.type === "list" && view.empty && !top.query ? view.empty.title : "No matches"
            }}
          </div>
        </div>
        <aside v-if="preview" class="hub-preview ui-scroll"><Blocks :blocks="preview" /></aside>
      </template>

      <footer class="hub-footer">
        <span class="hub-count">{{ rows.length }} result{{ rows.length === 1 ? "" : "s" }}</span>
        <template v-if="view?.type === 'form'">
          <button class="hub-primary ui-button" data-variant="primary" @click="submitForm">
            {{ view.submitTitle }} <kbd>{{ isMac ? "⌘" : "Ctrl" }}</kbd
            ><kbd>↵</kbd>
          </button>
        </template>
        <template v-else>
          <button
            v-if="primary"
            class="hub-primary ui-button"
            data-variant="primary"
            @click="run(selectedRow, primary)"
          >
            {{ primary.title }} <kbd>↵</kbd>
          </button>
          <button v-else class="hub-primary ui-button" data-variant="primary" disabled>
            Select a result
          </button>
          <button
            v-if="currentActions.length > 1"
            class="hub-actions ui-button"
            data-variant="quiet"
            @click="
              actionsOpen = !actionsOpen;
              actionIndex = 0;
            "
          >
            Actions <kbd>{{ isMac ? "⌘" : "Ctrl" }}</kbd
            ><kbd>K</kbd>
          </button>
        </template>
        <div v-if="actionsOpen" class="ui-frame ui-hub-actions" role="menu">
          <button
            v-for="(a, i) in currentActions"
            :key="a.id"
            class="ui-button"
            role="menuitem"
            :aria-pressed="i === actionIndex"
            :data-variant="a.style === 'destructive' ? 'danger' : 'quiet'"
            @mousemove="actionIndex = i"
            @click="run(selectedRow, a)"
          >
            <span>{{ a.title }}</span>
            <span class="ui-hub-keycaps"
              ><kbd v-for="k in i === 0 ? ['↵'] : keycap(a.shortcut)" :key="k">{{ k }}</kbd></span
            >
          </button>
        </div>
      </footer>

      <div
        v-if="confirming"
        class="ui-frame ui-hub-confirm"
        role="alertdialog"
        :aria-label="confirming.action.confirm?.title"
      >
        <h3>{{ confirming.action.confirm?.title }}</h3>
        <p>{{ confirming.action.confirm?.message }}</p>
        <div class="ui-hub-confirm-actions">
          <button class="ui-button" data-variant="quiet" @click="confirming = null">
            Cancel <kbd>Esc</kbd>
          </button>
          <button
            class="ui-button"
            data-variant="danger"
            @click="run(confirming.row, confirming.action, true)"
          >
            {{ confirming.action.confirm?.confirmLabel ?? "Confirm" }} <kbd>↵</kbd>
          </button>
        </div>
      </div>
    </section>
  </dialog>
</template>

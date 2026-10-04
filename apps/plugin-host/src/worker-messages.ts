import { type } from "arktype";
import { jsonValue } from "@moxi/contracts";
import type { ToHost } from "@moxi/sdk/host";

export const pluginLimits = {
  items: 500,
  nodes: 2000,
  text: 4000,
  messagesPerSecond: 500,
  views: 32,
  hudWidgets: 32,
  depth: 64,
  values: 16000,
} as const;

const text = type("string").atMostLength(pluginLimits.text);
const number = type("number.safe >= 0");
const ui = type
  .scope({
    icon: "skillIcon | professionIcon | glyphIcon",
    skillIcon: { skill: number },
    professionIcon: {
      profession:
        "'warrior' | 'ranger' | 'monk' | 'necromancer' | 'mesmer' | 'elementalist' | 'assassin' | 'ritualist' | 'paragon' | 'dervish'",
    },
    glyphIcon: { glyph: text },
    tone: "'default' | 'muted' | 'positive' | 'warning' | 'danger' | 'accent'",
    accessory: [{ text, "tone?": "tone | undefined" }, "|", { icon: "icon", label: text }],
    block: "textBlock | skillbarBlock | metaBlock",
    textBlock: { type: "'text'", text, "tone?": "tone | undefined" },
    skillbarBlock: { type: "'skillbar'", skills: number.array(), "elite?": number.or("undefined") },
    metaBlock: { type: "'meta'", rows: type([text, text]).array() },
    confirm: {
      title: text,
      "message?": text.or("undefined"),
      "confirmLabel?": text.or("undefined"),
    },
    action: {
      id: text,
      title: text,
      "icon?": "icon | undefined",
      "shortcut?": text.or("undefined"),
      "style?": "'default' | 'destructive' | undefined",
      "confirm?": "confirm | undefined",
      kind: "'run' | 'push' | 'copy'",
      "copy?": text.or("undefined"),
    },
    item: {
      id: text,
      title: text,
      "subtitle?": text.or("undefined"),
      "icon?": "icon | undefined",
      "keywords?": text.array().or("undefined"),
      "accessories?": "accessory[] | undefined",
      "preview?": "block[] | undefined",
      actions: "action[]",
      "scope?": text.or("undefined"),
      "aliases?": text.array().or("undefined"),
    },
    field: "textField | selectField | toggleField",
    textField: {
      type: "'text'",
      id: text,
      label: text,
      "value?": text.or("undefined"),
      "placeholder?": text.or("undefined"),
    },
    selectField: {
      type: "'select'",
      id: text,
      label: text,
      "value?": text.or("undefined"),
      options: type({ value: text, label: text }).array(),
    },
    toggleField: { type: "'toggle'", id: text, label: text, "value?": "boolean | undefined" },
    hud: [
      { type: "'text'", text, "tone?": "tone | undefined", "size?": "'s' | 'm' | 'l' | undefined" },
      "|",
      { type: "'row'", children: "hud[]" },
    ],
  })
  .export();
const items = ui.item.array().atMostLength(pluginLimits.items);
const view = type({
  type: "'list'",
  title: text,
  "placeholder?": text.or("undefined"),
  items,
  filter: "'host' | 'plugin'",
  "loading?": "boolean | undefined",
  "empty?": type({ title: text, "description?": text.or("undefined") }).or("undefined"),
})
  .or({ type: "'detail'", title: text, blocks: ui.block.array(), actions: ui.action.array() })
  .or({ type: "'form'", title: text, fields: ui.field.array(), submitTitle: text });

const request = type({
  t: "'request'",
  reqId: number,
  activation: text.or("null"),
  op: "'game.loadBuild'",
  args: { code: text, "on?": type("'self'").or({ hero: number }).or("undefined") },
})
  .or({
    t: "'request'",
    reqId: number,
    activation: text.or("null"),
    op: "'game.travel'",
    args: { mapId: number },
  })
  .or({
    t: "'request'",
    reqId: number,
    activation: text.or("null"),
    op: "'doc.read'",
    args: { name: text.moreThanLength(0) },
  })
  .or({
    t: "'request'",
    reqId: number,
    activation: text.or("null"),
    op: "'doc.write'",
    args: { name: text.moreThanLength(0), value: jsonValue },
  })
  .or({
    t: "'request'",
    reqId: number,
    activation: text.or("null"),
    op: "'toast'",
    args: {
      title: text,
      "message?": text.or("undefined"),
      "tone?": "'default' | 'positive' | 'danger' | undefined",
    },
  });

const messages = {
  ready: type({ t: "'ready'" }),
  subscribe: type({ t: "'subscribe'", slice: "'player' | 'target' | 'map'" }),
  items: type({ t: "'items'", items }),
  hud: type({ t: "'hud'", id: text, node: ui.hud.or("null") }),
  view: type({ t: "'view'", viewId: text, view }),
  commandDone: type({ t: "'commandDone'", opId: number }),
  queryResult: type({ t: "'queryResult'", reqId: number, items }),
  request,
  error: type({ t: "'error'", message: text, "stack?": text.or("undefined") }),
  pong: type({ t: "'pong'", seq: number }),
} satisfies Record<ToHost["t"], unknown>;
const message = type.or(...Object.values(messages));

export type WorkerMessage = typeof message.infer;

export function readWorkerMessage(value: unknown): WorkerMessage | null {
  // Bound traversal before recursive schemas, including cycles and deeply nested trees.
  const pending = [{ value, depth: 0 }];
  let values = 0;
  let nodes = 0;
  while (pending.length) {
    if (++values > pluginLimits.values) return null;
    const entry = pending.pop()!;
    if (typeof entry.value === "string" && entry.value.length > pluginLimits.text) return null;
    if (!entry.value || typeof entry.value !== "object") continue;
    if (entry.depth > pluginLimits.depth) return null;
    if (entry.depth > 0 && !Array.isArray(entry.value) && ++nodes > pluginLimits.nodes) return null;
    const children: unknown[] = Object.values(entry.value);
    if (children.length > pluginLimits.nodes) return null;
    for (const child of children) pending.push({ value: child, depth: entry.depth + 1 });
  }
  const parsed = message(value);
  return parsed instanceof type.errors ? null : (parsed satisfies ToHost);
}

import type { Observed, Slice } from "./game.ts";
import type { Block, HudNode, Icon, Accessory, Confirm, Field, Tone } from "./nodes.ts";

export type Manifest = {
  id: string;
  name: string;
  version: string;
  api: 1;
  description: string;
  icon?: Icon | undefined;
  permissions: readonly string[];
  activation: readonly ("game" | "hub" | "command")[];
  commands: readonly {
    id: string;
    title: string;
    subtitle?: string | undefined;
    keywords?: readonly string[] | undefined;
    icon?: Icon | undefined;
  }[];
  scopes?: readonly string[] | undefined;
  settings?: readonly {
    key: string;
    label: string;
    type: "number" | "toggle";
    default: number | boolean;
  }[];
};

// Serialized nodes: same shape as nodes.ts with functions replaced by markers.
export type WireAction = {
  id: string;
  title: string;
  icon?: Icon | undefined;
  shortcut?: string | undefined;
  style?: "default" | "destructive" | undefined;
  confirm?: Confirm | undefined;
  kind: "run" | "push" | "copy";
  copy?: string | undefined;
};
export type WireItem = {
  id: string;
  title: string;
  subtitle?: string | undefined;
  icon?: Icon | undefined;
  keywords?: readonly string[] | undefined;
  accessories?: readonly Accessory[] | undefined;
  preview?: readonly Block[] | undefined;
  actions: WireAction[];
  scope?: string | undefined;
  aliases?: readonly string[] | undefined;
};
export type WireView =
  | {
      type: "list";
      title: string;
      placeholder?: string | undefined;
      items: WireItem[];
      filter: "host" | "plugin";
      loading?: boolean | undefined;
      empty?: { title: string; description?: string | undefined } | undefined;
    }
  | { type: "detail"; title: string; blocks: readonly Block[]; actions: WireAction[] }
  | { type: "form"; title: string; fields: readonly Field[]; submitTitle: string };

export type ToHost =
  | { t: "ready" }
  | { t: "subscribe"; slice: Slice }
  | { t: "items"; items: WireItem[] }
  | { t: "hud"; id: string; node: HudNode | null }
  | { t: "view"; viewId: string; view: WireView }
  | { t: "commandDone"; opId: number }
  | { t: "queryResult"; reqId: number; items: WireItem[] }
  | { t: "request"; reqId: number; op: RequestOp; args: unknown; activation: string | null }
  | { t: "error"; message: string; stack?: string | undefined }
  | { t: "pong"; seq: number };

export type RequestOp = "game.loadBuild" | "game.travel" | "doc.read" | "doc.write" | "toast";

export type ToPlugin =
  | { t: "init"; manifest: Manifest; settings: Record<string, number | boolean> }
  | { t: "slice"; slice: Slice; value: Observed<unknown> }
  | { t: "command"; opId: number; id: string; viewId: string; activation: string }
  | {
      t: "invoke";
      viewId: string;
      target: string;
      activation: string;
      args?: unknown[] | undefined;
    }
  | { t: "closeView"; viewId: string }
  | { t: "query"; reqId: number; text: string; scope: string | null }
  | { t: "result"; reqId: number; value: unknown }
  | { t: "doc"; name: string; value: unknown }
  | { t: "settings"; values: Record<string, number | boolean> }
  | { t: "ping"; seq: number };

export type ToastTone = Extract<Tone, "default" | "positive" | "danger">;

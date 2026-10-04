import type { Game } from "./game.ts";
import type { HubItem, HudNode, View } from "./nodes.ts";
import type { Manifest, ToastTone } from "./protocol.ts";

declare global {
  var __moxiPluginSetup: Setup | undefined;
}

export * from "./nodes.ts";
export type * from "./game.ts";
export type { Manifest } from "./protocol.ts";
export { ref, shallowRef, computed, reactive } from "@vue/reactivity";

export type Doc<T> = {
  value(): T;
  set(next: T): Promise<void>;
};

export type PluginContext = {
  readonly manifest: Manifest;
  readonly signal: AbortSignal;
  readonly game: Game;
  settings(): Readonly<Record<string, number | boolean>>;
  readonly hub: {
    items(render: () => readonly HubItem[]): void;
    query(
      handler: (
        text: string,
        scope: string | null,
        signal: AbortSignal,
      ) => readonly HubItem[] | Promise<readonly HubItem[]>,
    ): void;
  };
  readonly commands: {
    view(id: string, render: () => View): void;
    action(id: string, run: () => unknown): void;
  };
  readonly hud: {
    widget(id: string, render: () => HudNode | null): void;
  };
  readonly storage: {
    doc<T>(name: string, initial: () => T): Doc<T>;
  };
  readonly ui: {
    toast(toast: { title: string; message?: string; tone?: ToastTone }): void;
  };
};

export type Setup = (ctx: PluginContext) => void | Promise<void>;

export function definePlugin(setup: Setup): Setup {
  globalThis.__moxiPluginSetup = setup;
  return setup;
}

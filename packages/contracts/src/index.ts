import { type, type Type } from "arktype";

export interface Channel<Req, Res> {
  request: Type<Req>;
  response: Type<Res>;
}
export function defineChannel<Req, Res>(spec: {
  request: Type<Req>;
  response: Type<Res>;
}): Channel<Req, Res> {
  return spec;
}
export const socketEvent = type({ id: "number.safe >= 0", kind: "'open' | 'close'" }).or(
  type({ id: "number.safe >= 0", kind: "'data'", bytes: type.instanceOf(Uint8Array) }),
);
export type SocketEvent = typeof socketEvent.infer;
const socketId = type({ id: "number.safe >= 0" });
export const download = type({
  status: "'running' | 'paused' | 'complete'",
  received: "number.safe >= 0",
  total: "number.safe >= 0",
  bytesPerSecond: "number >= 0 | null",
  secondsRemaining: "number >= 0 | null",
});
export const clientReadiness = type({
  state: "'playable'",
  backgroundDownload: download.or("null"),
})
  .or({
    state: "'offline-playable'",
    "gameFilesInfo?": type({ bytes: "number.safe >= 0", totalBytes: "number.safe >= 0" }),
  })
  .or({ state: "'repair-required'" })
  .or({ state: "'preparing'", progress: download });
export type Readiness = typeof clientReadiness.infer;
export type Download = typeof download.infer;
import { documentRef, documentValue, documentWrite, documentWriteResult } from "./documents.js";
export {
  documentRef,
  documentValue,
  documentChange,
  jsonValue,
  type DocumentRef,
  type DocumentChange,
  type Json,
} from "./documents.js";
export const channels = {
  "plugin.doc.read": defineChannel({ request: documentRef, response: documentValue.or("null") }),
  "plugin.doc.write": defineChannel({ request: documentWrite, response: documentWriteResult }),
  "plugin.bundles": defineChannel({
    request: type("undefined"),
    response: type({ manifest: "unknown", source: "string", bytes: "number.safe >= 0" }).array(),
  }),
  "download.pause": defineChannel({ request: type("undefined"), response: type("undefined") }),
  "download.resume": defineChannel({ request: type("undefined"), response: type("undefined") }),
  "client.readiness": defineChannel({ request: type("undefined"), response: clientReadiness }),
  "client.retry": defineChannel({ request: type("undefined"), response: type("undefined") }),
  "tools.list": defineChannel({ request: type("undefined"), response: toolList }),
  "tools.set": defineChannel({ request: toolSwitch, response: toolList }),
  "game.net.connect": defineChannel({
    request: type({ id: "number.safe >= 0", destination: "string <= 256" }),
    response: type("undefined"),
  }),
  "game.net.write": defineChannel({
    request: type({ id: "number.safe >= 0", bytes: type.instanceOf(Uint8Array) }),
    response: type("undefined"),
  }),
  "game.net.close": defineChannel({ request: socketId, response: type("undefined") }),
  "game.net.ack": defineChannel({
    request: type({ id: "number.safe >= 0", bytes: "number.safe > 0" }),
    response: type("undefined"),
  }),
  "game.dns": defineChannel({ request: type("string <= 253"), response: type("string") }),
  "game.net.healthy": defineChannel({
    request: type({ token: "string.uuid", frame: "boolean" }),
    response: type("boolean"),
  }),
  "game.client.failed": defineChannel({
    request: type("string.uuid"),
    response: type("undefined"),
  }),
  "app.info": defineChannel({
    request: type("undefined"),
    response: type({
      productName: "string",
      version: "string",
      channel: "'dev' | 'beta' | 'stable'",
    }),
  }),
  "game.client": defineChannel({
    request: type("undefined"),
    response: type({ generationToken: "string.uuid", snapshotSize: "number.safe > 0" }),
  }),
  "accounts.list": defineChannel({ request: type("undefined"), response: accountList }),
  "accounts.save": defineChannel({ request: accountSave, response: accountList }),
  "accounts.archive": defineChannel({
    request: type({ id: accountId, archived: "boolean" }),
    response: accountList,
  }),
  "accounts.remove": defineChannel({ request: type({ id: accountId }), response: accountList }),
  "accounts.select": defineChannel({ request: accountSelection, response: accountList }),
  "accounts.play": defineChannel({
    request: type({ ids: accountId.array().atLeastLength(1).atMostLength(16) }),
    response: type("undefined"),
  }),
};
import { windowChannels, type WindowKind } from "./windows.js";
import { accountId, accountList, accountSave, accountSelection, type Account } from "./accounts.js";
import { toolList, toolSwitch, type ToolSwitch } from "./tools.js";
export { accountId, type Account, type AccountSave } from "./accounts.js";
export { toolId, type Tool, type ToolSwitch } from "./tools.js";
export { hubPortMessage, windowChannels, type WindowKind } from "./windows.js";
/** Where Main asks the launcher to go when it brings the launcher back, e.g. from the Accounts menu. */
export type LauncherDestination = "accounts";
export type ChannelName = keyof typeof channels;
export type RequestOf<N extends ChannelName> = (typeof channels)[N]["request"]["infer"];
export type ResponseOf<N extends ChannelName> = (typeof channels)[N]["response"]["infer"];
export type Bridge<K extends WindowKind> = {
  invoke<N extends (typeof windowChannels)[K][number]>(
    name: N,
    request: RequestOf<N>,
  ): Promise<ResponseOf<N>>;
} & (K extends "game"
  ? {
      onSocketEvent(listener: (event: SocketEvent) => void): () => void;
    }
  : K extends "launcher"
    ? {
        onReadinessChanged(listener: (readiness: Readiness) => void): () => void;
        onAccountsChanged(listener: (accounts: Account[]) => void): () => void;
        onNavigate(listener: (destination: LauncherDestination) => void): () => void;
      }
    : K extends "pluginHost"
      ? {
          /** The one tool the player just switched on or off; the list comes from `tools.list`. */
          onToolSwitched(listener: (change: ToolSwitch) => void): () => void;
          onDocumentChanged(
            listener: (change: import("./documents.js").DocumentChange) => void,
          ): () => void;
        }
      : {});
export function validateRequest(name: ChannelName, kind: WindowKind | undefined, input: unknown) {
  if (!kind || !windowChannels[kind].some((allowed) => allowed === name))
    throw new Error("This window cannot use that action.");
  return channels[name].request.assert(input);
}

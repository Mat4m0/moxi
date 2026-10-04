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
export const channels = {
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
  "game.net.healthy": defineChannel({ request: type("string.uuid"), response: type("undefined") }),
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
  "game.open": defineChannel({ request: type("undefined"), response: type("undefined") }),
};
import { windowChannels, type WindowKind } from "./windows.js";
export { hubPortMessage, windowChannels, type WindowKind } from "./windows.js";
export type ChannelName = keyof typeof channels;
export type RequestOf<N extends ChannelName> = (typeof channels)[N]["request"]["infer"];
export type ResponseOf<N extends ChannelName> = (typeof channels)[N]["response"]["infer"];
export type Bridge<K extends WindowKind> = {
  invoke<N extends (typeof windowChannels)[K][number]>(
    name: N,
    request: RequestOf<N>,
  ): Promise<ResponseOf<N>>;
} & (K extends "game" ? { onSocketEvent(listener: (event: SocketEvent) => void): () => void } : {});
export function validateRequest(name: ChannelName, kind: WindowKind | undefined, input: unknown) {
  if (!kind || !windowChannels[kind].some((allowed) => allowed === name))
    throw new Error("This window cannot use that action.");
  return channels[name].request.assert(input);
}

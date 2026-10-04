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
export const channels = {
  "app.info": defineChannel({
    request: type("undefined"),
    response: type({
      productName: "string",
      version: "string",
      channel: "'dev' | 'beta' | 'stable'",
    }),
  }),
  "game.open": defineChannel({ request: type("undefined"), response: type("undefined") }),
};
import { windowChannels, type WindowKind } from "./windows.js";
export { windowChannels, type WindowKind } from "./windows.js";
export type ChannelName = keyof typeof channels;
export type RequestOf<N extends ChannelName> = (typeof channels)[N]["request"]["infer"];
export type ResponseOf<N extends ChannelName> = (typeof channels)[N]["response"]["infer"];
export type Bridge<K extends WindowKind> = {
  invoke<N extends (typeof windowChannels)[K][number]>(
    name: N,
    request: RequestOf<N>,
  ): Promise<ResponseOf<N>>;
};
export function validateRequest(name: ChannelName, kind: WindowKind | undefined, input: unknown) {
  if (!kind || !windowChannels[kind].some((allowed) => allowed === name))
    throw new Error("This window cannot use that action.");
  return channels[name].request.assert(input);
}

import { type } from "arktype";

// A bundled plugin id, as in its manifest (for example `moxi.builds`).
export const toolId = type("string & /^[A-Za-z0-9.-]{1,64}$/");
export const tool = type({
  id: toolId,
  name: "string",
  description: "string",
  enabled: "boolean",
});
export type Tool = typeof tool.infer;
export const toolList = tool.array();
export const toolSwitch = type({ id: toolId, enabled: "boolean" });
export type ToolSwitch = typeof toolSwitch.infer;

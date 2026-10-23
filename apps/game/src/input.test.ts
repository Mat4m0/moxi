// @vitest-environment happy-dom
import { afterEach, expect, test } from "vite-plus/test";
import { installGameInput } from "./input";

let installed: ReturnType<typeof installGameInput> | undefined;
afterEach(() => {
  installed?.dispose();
  installed = undefined;
  document.body.replaceChildren();
});

function page(skip: string[] = []) {
  document.body.innerHTML = `<canvas id="canvas" tabindex="0"></canvas>`;
  for (const name of ["text", "email", "password", "number", "multiline"])
    if (!skip.includes(name)) {
      const field = document.createElement(name === "multiline" ? "textarea" : "input");
      field.id = `osk-input-${name}`;
      field.tabIndex = -1;
      document.body.append(field);
    }
  const canvas = document.querySelector("canvas") as HTMLCanvasElement;
  const active: { value: unknown; typing: boolean } = { value: undefined, typing: false };
  installed = installGameInput(
    canvas,
    () => active.value,
    () => active.typing,
  );
  return { canvas, active, field: (name: string) => document.getElementById(`osk-input-${name}`)! };
}

function key(type: string, init: KeyboardEventInit & { keyCode?: number }) {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "keyCode", { value: init.keyCode ?? 0 });
  Object.defineProperty(event, "which", { value: init.keyCode ?? 0 });
  return event;
}

test("gives the client every text field it focuses to read text", () => {
  const { field } = page();
  expect(installed?.oskInput.password).toBe(field("password"));
  expect(installed?.oskInput.multiline).toBe(field("multiline"));
  expect(Object.keys(installed?.oskInput ?? {})).toEqual([
    "text",
    "email",
    "password",
    "number",
    "multiline",
  ]);
});

test("refuses to start when a text field is missing", () => {
  expect(() => page(["password"])).toThrow('The game text field "password" is missing.');
});

test("a repeated arrow press is preceded by a release, so chat history keeps moving", () => {
  const { field } = page();
  const seen: string[] = [];
  window.addEventListener("keydown", (event) => seen.push(`down:${event.repeat}`));
  window.addEventListener("keyup", (event) => seen.push(`up:${event.keyCode}`));
  const arrow = { key: "ArrowUp", code: "ArrowUp", keyCode: 38 };
  field("text").dispatchEvent(key("keydown", arrow));
  field("text").dispatchEvent(key("keydown", { ...arrow, repeat: true }));
  expect(seen).toEqual(["down:false", "up:38", "down:true"]);
});

test("a held Backspace or letter repeat passes through untouched", () => {
  const { field } = page();
  const seen: string[] = [];
  window.addEventListener("keydown", (event) => seen.push(`down:${event.key}`));
  window.addEventListener("keyup", (event) => seen.push(`up:${event.key}`));
  for (const init of [
    { key: "Backspace", code: "Backspace" },
    { key: "a", code: "KeyA" },
  ])
    field("text").dispatchEvent(key("keydown", { ...init, repeat: true }));
  expect(seen).toEqual(["down:Backspace", "down:a"]);
});

test("the Command key never reaches the game", () => {
  const { canvas } = page();
  const seen: string[] = [];
  window.addEventListener("keydown", (event) => seen.push(event.code));
  window.addEventListener("keyup", (event) => seen.push(event.code));
  canvas.dispatchEvent(key("keydown", { key: "Meta", code: "MetaLeft", metaKey: true }));
  canvas.dispatchEvent(key("keyup", { key: "Meta", code: "MetaLeft" }));
  canvas.dispatchEvent(key("keydown", { key: "a", code: "KeyA" }));
  expect(seen).toEqual(["KeyA"]);
});

test("Tab inside a text field does not also move focus", () => {
  const { field, canvas } = page();
  const tab = key("keydown", { key: "Tab", code: "Tab" });
  field("text").dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true);
  const other = key("keydown", { key: "Tab", code: "Tab" });
  canvas.dispatchEvent(other);
  expect(other.defaultPrevented).toBe(false);
});

test("a field the client did not ask for hands focus back to the canvas", async () => {
  const { canvas, active, field } = page();
  active.value = field("text");
  field("text").focus();
  await Promise.resolve();
  expect(document.activeElement).toBe(field("text"));
  field("email").focus();
  await Promise.resolve();
  expect(document.activeElement).toBe(canvas);
});

test("focus moving into a text field is not seen as the window losing focus", () => {
  const { canvas, field } = page();
  const blurs: unknown[] = [];
  canvas.addEventListener("blur", (event) => blurs.push(event.relatedTarget));
  canvas.dispatchEvent(new FocusEvent("blur", { relatedTarget: field("text") }));
  canvas.dispatchEvent(new FocusEvent("blur"));
  expect(blurs).toEqual([null]);
});

test("a click on the canvas takes focus back from a hidden field, unless the client is typing", () => {
  const { canvas, active, field } = page();
  field("password").focus();
  canvas.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(document.activeElement).toBe(canvas);

  field("text").focus();
  active.typing = true;
  canvas.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(document.activeElement).toBe(field("text"));
});

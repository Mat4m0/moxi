// Keyboard host for the official client: the hidden text fields it types into, and the key
// rules it needs from the page. The glue focuses these fields to read text; without them
// nothing can be typed at login or in chat.
const FIELDS = ["text", "email", "password", "number", "multiline"] as const;
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export type OskInput = Record<(typeof FIELDS)[number], HTMLElement>;

function releaseOf(press: KeyboardEvent) {
  const release = new KeyboardEvent("keyup", {
    bubbles: true,
    cancelable: true,
    key: press.key,
    code: press.code,
    location: press.location,
    ctrlKey: press.ctrlKey,
    shiftKey: press.shiftKey,
    altKey: press.altKey,
    metaKey: press.metaKey,
  });
  // The client's glue still reads these read-only legacy fields.
  Object.defineProperties(release, {
    charCode: { value: press.charCode },
    keyCode: { value: press.keyCode },
    which: { value: press.which },
  });
  return release;
}

export function installGameInput(
  canvas: HTMLCanvasElement,
  activeField: () => unknown,
  typing: () => boolean,
) {
  const found = FIELDS.map((name) => [name, document.getElementById(`osk-input-${name}`)] as const);
  const missing = found.find(([, element]) => !element);
  if (missing) throw new Error(`The game text field "${missing[0]}" is missing.`);
  const oskInput = Object.fromEntries(found) as OskInput;
  const fields = new Set<EventTarget>(Object.values(oskInput));

  const controller = new AbortController();
  const { signal } = controller;
  // Guild Wars has no Command key. Chromium and the menu keep the combination.
  const isCommand = (event: KeyboardEvent) =>
    event.code === "MetaLeft" || event.code === "MetaRight";
  window.addEventListener(
    "keydown",
    (event) => {
      if (isCommand(event)) return event.stopImmediatePropagation();
      // The client changes its active field in its own keydown. A second Chromium Tab move
      // from the newly focused field would make focus skip.
      if (event.key === "Tab" && event.target && fields.has(event.target)) event.preventDefault();
      // The client treats arrows as transitions and ignores a repeated keydown while the first
      // press is held. A release before each native repeat lets chat history and the cursor
      // follow the macOS repeat rate. macOS stays the only repeat clock.
      if (event.repeat && ARROWS.has(event.key)) event.target?.dispatchEvent(releaseOf(event));
    },
    { capture: true, signal },
  );
  window.addEventListener(
    "keyup",
    (event) => {
      if (isCommand(event)) event.stopImmediatePropagation();
    },
    { capture: true, signal },
  );
  // Focus moving from the canvas into a text field is not the window losing focus.
  canvas.addEventListener(
    "blur",
    (event) => {
      if (event.relatedTarget instanceof Element) event.stopImmediatePropagation();
    },
    { capture: true, signal },
  );
  // The client cancels the default focus change of a click on the canvas. Without this the
  // hidden field used for typing keeps focus, and keys such as C and Escape never reach the game.
  canvas.addEventListener(
    "pointerdown",
    () => {
      if (!typing() && document.activeElement !== canvas) canvas.focus();
    },
    { capture: true, signal },
  );
  // A field the client did not ask for gives focus back, so keys never land in a stray field.
  for (const element of Object.values(oskInput))
    element.addEventListener(
      "focus",
      () =>
        queueMicrotask(() => {
          if (activeField() !== element && document.activeElement === element) canvas.focus();
        }),
      { signal },
    );
  return { oskInput, dispose: () => controller.abort() };
}

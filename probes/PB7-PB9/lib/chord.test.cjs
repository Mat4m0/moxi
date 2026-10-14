"use strict";
// Matcher and validator tables. The Input objects are built by hand from documented layout
// behavior (Electron `Input`: type, key, code, shift, control, alt, meta, isAutoRepeat),
// not recorded from hardware: switching layouts on runners is unreliable (PB9 setup).
const test = require("node:test");
const assert = require("node:assert/strict");
const { ChordRouter, matches, validateSuggestion } = require("./chord.cjs");

const input = (over) => ({
  type: "keyDown", key: "", code: "", isAutoRepeat: false, isComposing: false,
  shift: false, control: false, alt: false, meta: false, location: 0, modifiers: [], ...over,
});

const hubWin = { id: "hub.toggle", scope: "always", code: "KeyR", ctrl: true };
const hubMac = { id: "hub.toggle", scope: "always", code: "KeyR", meta: true };
const pluginWin = { id: "plugin.k", scope: "world", code: "KeyK", ctrl: true };

const matcherTable = [
  ["US Ctrl+R", hubWin, input({ key: "r", code: "KeyR", control: true }), true],
  ["US Ctrl+Shift+R", hubWin, input({ key: "R", code: "KeyR", control: true, shift: true }), false],
  ["US plain R", hubWin, input({ key: "r", code: "KeyR" }), false],
  ["Windows AltGr as Ctrl+Alt+R", hubWin, input({ key: "r", code: "KeyR", control: true, alt: true }), false],
  ["German AltGr+Q (@) as Ctrl+Alt", { code: "KeyQ", ctrl: true }, input({ key: "@", code: "KeyQ", control: true, alt: true }), false],
  ["Linux AltGraph key itself", hubWin, input({ key: "AltGraph", code: "AltRight", control: true }), false],
  ["Linux Ctrl with extra altgr modifier name", hubWin, input({ key: "r", code: "KeyR", control: true, modifiers: ["control", "altgr"] }), false],
  ["German Ctrl+Z is physical KeyY, binding KeyZ", { code: "KeyZ", ctrl: true }, input({ key: "z", code: "KeyY", control: true }), false],
  ["German Ctrl+Z is physical KeyY, binding KeyY", { code: "KeyY", ctrl: true }, input({ key: "z", code: "KeyY", control: true }), true],
  ["AZERTY Ctrl+A is physical KeyQ, binding KeyA", { code: "KeyA", ctrl: true }, input({ key: "a", code: "KeyQ", control: true }), false],
  ["AZERTY Ctrl+R keeps KeyR", hubWin, input({ key: "r", code: "KeyR", control: true }), true],
  ["AZERTY unshifted Digit1 types &", { code: "Digit1", ctrl: true }, input({ key: "&", code: "Digit1", control: true }), true],
  ["US-International dead key", pluginWin, input({ key: "Dead", code: "Quote", control: true }), false],
  ["US-International Ctrl+K", pluginWin, input({ key: "k", code: "KeyK", control: true }), true],
  ["macOS Cmd+R", hubMac, input({ key: "r", code: "KeyR", meta: true }), true],
  ["macOS Ctrl+R is not Cmd+R", hubMac, input({ key: "r", code: "KeyR", control: true }), false],
  ["macOS Option+A types a-ring", { code: "KeyA", meta: true }, input({ key: "å", code: "KeyA", alt: true }), false],
];

for (const [name, binding, event, expected] of matcherTable) {
  test(`matches: ${name}`, () => assert.equal(matches(event, binding), expected));
}

test("router swallows key down, repeats and key up, and fires once", () => {
  const router = new ChordRouter({ bindings: [hubWin] });
  const ctx = { session: "world" };
  const down = router.handle(input({ code: "KeyR", control: true }), ctx);
  const repeat = router.handle(input({ code: "KeyR", control: true, isAutoRepeat: true }), ctx);
  // Control released before R: the key up carries no modifiers but must still be swallowed.
  const up = router.handle(input({ type: "keyUp", code: "KeyR" }), ctx);
  assert.deepEqual([down.swallow, down.fire], [true, "hub.toggle"]);
  assert.deepEqual([repeat.swallow, repeat.fire], [true, null]);
  assert.deepEqual([up.swallow, up.fire], [true, null]);
  const after = router.handle(input({ type: "keyUp", code: "KeyR" }), ctx);
  assert.equal(after.swallow, false);
});

test("router lets an unmatched key up through", () => {
  const router = new ChordRouter({ bindings: [hubWin] });
  assert.equal(router.handle(input({ type: "keyUp", code: "KeyK" }), { session: "world" }).swallow, false);
});

test("down-only router leaks the key up", () => {
  const router = new ChordRouter({ bindings: [hubWin], downOnly: true });
  router.handle(input({ code: "KeyR", control: true }), { session: "world" });
  assert.equal(router.handle(input({ type: "keyUp", code: "KeyR" }), { session: "world" }).swallow, false);
});

const sessionTable = [
  ["login", false],
  ["charselect", false],
  ["world", true],
];
for (const [session, fires] of sessionTable) {
  test(`plugin chord in ${session}: ${fires ? "runs" : "reaches the page"}`, () => {
    const router = new ChordRouter({ bindings: [hubWin, pluginWin] });
    const d = router.handle(input({ code: "KeyK", control: true }), { session });
    assert.deepEqual([d.swallow, d.fire], fires ? [true, "plugin.k"] : [false, null]);
  });
}

test("hub chord works in every session", () => {
  for (const session of ["login", "charselect", "world"]) {
    const router = new ChordRouter({ bindings: [hubWin, pluginWin] });
    assert.equal(router.handle(input({ code: "KeyR", control: true }), { session }).fire, "hub.toggle");
  }
});

const key = (code, flags) => ({ code, ...flags });
const win = { platform: "win32", reservedHub: hubWin };
const mac = { platform: "darwin", reservedHub: hubMac };
const validatorTable = [
  ["Shift+K", key("KeyK", { shift: true }), win, false],
  ["Shift+1", key("Digit1", { shift: true }), win, false],
  ["Alt+A", key("KeyA", { alt: true }), win, false],
  ["Option+A (macOS)", key("KeyA", { alt: true }), mac, false],
  ["Ctrl+Alt+K", key("KeyK", { ctrl: true, alt: true }), win, false],
  ["Ctrl+C", key("KeyC", { ctrl: true }), win, false],
  ["Ctrl+R (Hub chord)", key("KeyR", { ctrl: true }), win, false],
  ["Ctrl+W", key("KeyW", { ctrl: true }), win, false],
  ["Alt+F4", key("F4", { alt: true }), win, false],
  ["Ctrl+K on macOS needs Cmd", key("KeyK", { ctrl: true }), mac, false],
  ["Ctrl+K", key("KeyK", { ctrl: true }), win, true],
  ["Ctrl+Shift+K", key("KeyK", { ctrl: true, shift: true }), win, true],
  ["Cmd+K (macOS)", key("KeyK", { meta: true }), mac, true],
  ["Ctrl+Digit1", key("Digit1", { ctrl: true }), win, true],
];
for (const [name, binding, options, ok] of validatorTable) {
  test(`validate: ${name} -> ${ok ? "assignable" : "refused"}`, () => {
    assert.equal(validateSuggestion(binding, options).ok, ok);
  });
}

test("the fifth valid chord stays unbound (4 per install)", () => {
  const suggestions = ["KeyK", "KeyJ", "KeyL", "KeyG", "KeyB"].map((code) => key(code, { ctrl: true }));
  const taken = [];
  const results = suggestions.map((s) => {
    const r = validateSuggestion(s, { ...win, taken });
    if (r.ok) taken.push(s);
    return r;
  });
  assert.deepEqual(results.map((r) => r.ok), [true, true, true, true, false]);
  assert.equal(results[4].reason, "install-limit");
});

// Recorded in CI (run 1, Linux X11, `setxkbmap de`, xdotool): AltGr is its own key event with an
// empty code; Ctrl+AltGr+R then arrives with control:true, alt:false and key "\u00b6".
const x11 = {
  ctrl: input({ key: "Control", code: "ControlLeft", control: true, location: 1, modifiers: ["control", "left"] }),
  altGr: input({ key: "AltGraph", code: "", control: true, modifiers: ["control"] }),
  r: input({ key: "\u00b6", code: "KeyR", control: true, modifiers: ["control"] }),
};
test("Linux X11 Ctrl+AltGr+R: a naive matcher fires, the AltGraph-tracking router does not", () => {
  const naive = new ChordRouter({ bindings: [hubWin], trackAltGraph: false });
  const guarded = new ChordRouter({ bindings: [hubWin] });
  const run = (router) => [x11.ctrl, x11.altGr, x11.r].map((i) => router.handle(i, { session: "world" }).fire);
  assert.deepEqual(run(naive), [null, null, "hub.toggle"]);
  assert.deepEqual(run(guarded), [null, null, null]);
});

test("AltGraph key up re-enables the chord", () => {
  const router = new ChordRouter({ bindings: [hubWin] });
  const ctx = { session: "world" };
  router.handle(x11.altGr, ctx);
  router.handle(input({ type: "keyUp", key: "AltGraph", code: "" }), ctx);
  assert.equal(router.handle(input({ key: "r", code: "KeyR", control: true }), ctx).fire, "hub.toggle");
});

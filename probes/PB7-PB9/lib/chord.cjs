"use strict";
// Reference matcher for the Main-side Hub chord and plugin shortcuts (DESIGN 12.3).
// Probe code to measure `before-input-event`; not product code.

const RESERVED_PLUGIN_CODES = new Set([
  "KeyW", "KeyQ", "KeyA", "KeyC", "KeyV", "KeyX", "KeyZ", "KeyY", "KeyR",
]);
const MAX_PLUGIN_BINDINGS_PER_INSTALL = 4;

const primaryFlag = (platform) => (platform === "darwin" ? "meta" : "ctrl");

// AltGr is Ctrl+Alt on Windows. On Linux X11 it may arrive as key "AltGraph" on its own
// key event, or as an extra modifier name; both are treated as AltGr here.
function isAltGr(input) {
  if (input.control && input.alt) return true;
  if (input.key === "AltGraph") return true;
  return (input.modifiers || []).some((m) => /alt.?gr/i.test(m));
}

// Exact modifier match on the physical key. Extra or missing modifiers never match.
function matches(input, binding) {
  if (isAltGr(input)) return false;
  return (
    input.code === binding.code &&
    Boolean(input.control) === Boolean(binding.ctrl) &&
    Boolean(input.alt) === Boolean(binding.alt) &&
    Boolean(input.shift) === Boolean(binding.shift) &&
    Boolean(input.meta) === Boolean(binding.meta)
  );
}

// Stateful router: swallows a matched key down, its auto-repeats, and its key up even when
// the modifiers were released first. Plugin chords are live only while session === "world".
class ChordRouter {
  // trackAltGraph: on Linux X11 AltGr arrives as its own key event (key "AltGraph", empty code)
  // and the next key carries ctrl without alt, so only a held-key flag can tell AltGr+Ctrl+R
  // from Ctrl+R. Reset it when the window loses focus, because a missed key up would leave it set.
  constructor({ bindings, downOnly = false, trackAltGraph = true }) {
    this.bindings = bindings;
    this.downOnly = downOnly;
    this.trackAltGraph = trackAltGraph;
    this.held = new Map(); // code -> binding id swallowed on key down
    this.altGraphDown = false;
  }

  reset() {
    this.held.clear();
    this.altGraphDown = false;
  }

  handle(input, ctx) {
    const type = input.type === "rawKeyDown" ? "keyDown" : input.type;
    if (this.trackAltGraph && input.key === "AltGraph") this.altGraphDown = type === "keyDown";
    if (type === "keyDown") {
      if (this.held.has(input.code)) return { swallow: true, fire: null, why: "held-repeat" };
      const hit = this.altGraphDown
        ? undefined
        : this.bindings.find((b) => matches(input, b) && (b.scope === "always" || ctx.session === "world"));
      if (!hit) return { swallow: false, fire: null, why: "no-match" };
      this.held.set(input.code, hit.id);
      return { swallow: true, fire: hit.id, why: "match" };
    }
    if (type === "keyUp") {
      if (!this.held.has(input.code)) return { swallow: false, fire: null, why: "no-match" };
      this.held.delete(input.code);
      return this.downOnly
        ? { swallow: false, fire: null, why: "down-only-leaks-up" }
        : { swallow: true, fire: null, why: "held-release" };
    }
    return { swallow: false, fire: null, why: "other-type" };
  }
}

// Which plugin-suggested chords may be assigned (DESIGN 12.3). `taken` holds the chords the
// install already has; `reservedHub` is the Hub chord.
function validateSuggestion(binding, { platform, taken = [], reservedHub }) {
  const primary = primaryFlag(platform);
  if (!binding[primary]) return { ok: false, reason: "needs-primary-modifier" };
  if (binding.ctrl && binding.alt) return { ok: false, reason: "ctrl-alt-is-altgr" };
  if (RESERVED_PLUGIN_CODES.has(binding.code)) return { ok: false, reason: "reserved" };
  if (binding.alt && binding.code === "F4") return { ok: false, reason: "reserved" };
  const same = (a, b) =>
    a.code === b.code &&
    Boolean(a.ctrl) === Boolean(b.ctrl) &&
    Boolean(a.alt) === Boolean(b.alt) &&
    Boolean(a.shift) === Boolean(b.shift) &&
    Boolean(a.meta) === Boolean(b.meta);
  if (reservedHub && same(binding, reservedHub)) return { ok: false, reason: "hub-chord" };
  if (taken.some((t) => same(t, binding))) return { ok: false, reason: "taken" };
  if (taken.length >= MAX_PLUGIN_BINDINGS_PER_INSTALL) return { ok: false, reason: "install-limit" };
  return { ok: true, reason: "ok" };
}

module.exports = { ChordRouter, matches, isAltGr, validateSuggestion, MAX_PLUGIN_BINDINGS_PER_INSTALL };

import { createApp } from "vue";
import { applyAppearance } from "@moxi/ui";
import { hubPortMessage } from "@moxi/contracts";
import type { HostToHub } from "@moxi/sdk/host";
import { connectHub, publishFacts } from "./client.ts";
import App from "./App.vue";
let appearanceChanged = false;
const unsubscribeAppearance = window.moxi.onAppearanceChanged((settings) => {
  appearanceChanged = true;
  applyAppearance(document.documentElement, settings);
});
void window.moxi
  .invoke("appearance.get", undefined)
  .then((settings) => {
    if (!appearanceChanged) applyAppearance(document.documentElement, settings);
  })
  .catch(() => {});
window.addEventListener("pagehide", unsubscribeAppearance, { once: true });
function receivePort(event: MessageEvent) {
  if (event.source !== window || event.data?.t !== hubPortMessage) return;
  const port = event.ports[0];
  if (!port) return;
  window.removeEventListener("message", receivePort);
  connectHub({
    post: (message) => port.postMessage(message),
    listen: (handler) => {
      port.onmessage = (message: MessageEvent<HostToHub>) => handler(message.data);
      port.start();
    },
  });
  publishFacts({
    player: { ok: false, reason: "unsupported" },
    target: { ok: false, reason: "unsupported" },
    map: { ok: false, reason: "unsupported" },
  });
  const app = createApp(App);
  app.mount("#hub-root");
  window.addEventListener(
    "pagehide",
    () => {
      app.unmount();
      port.close();
    },
    { once: true },
  );
}
window.addEventListener("message", receivePort);
window.postMessage("moxi-hub-ready", "*");

import { createApp } from "vue";
import type { HostToHub } from "@moxi/sdk/host";
import { connectHub } from "../client.ts";
import App from "./App.vue";

function receivePort(event: MessageEvent) {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    event.data?.t !== "moxi-hub-port"
  )
    return;
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
  const app = createApp(App);
  app.mount("#app");
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

import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import vue from "@vitejs/plugin-vue";

const root = resolve(import.meta.dirname, "../../../../..");
export default defineConfig({
  root,
  publicDir: "apps/plugin-host/dist",
  plugins: [
    vue(),
    {
      name: "hub-page",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url === "/") request.url = "/apps/game/hub.html";
          next();
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 4610, strictPort: true, open: false },
  build: { outDir: "apps/game/dist/hub", rolldownOptions: { input: "apps/game/hub.html" } },
});

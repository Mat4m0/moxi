import { pluginCsp } from "@moxi/desktop/plugin-isolation";
export default {
  base: "./",
  publicDir: "dist",
  server: { headers: { "Content-Security-Policy": pluginCsp } },
  build: { copyPublicDir: false },
};

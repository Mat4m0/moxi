import vue from "@vitejs/plugin-vue";
export default {
  base: "./",
  plugins: [vue()],
  server: { hmr: { protocol: "ws", host: "127.0.0.1", port: 4612 } },
};

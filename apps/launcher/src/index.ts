import { createApp } from "vue";
import App from "./App.vue";
import { bridgeData } from "./launcher-data";
import "@moxi/ui/tokens.css";
import "@moxi/ui/components.css";
import "@moxi/ui/fonts.css";
import "./style.css";

createApp(App, { data: bridgeData() }).mount("#app");

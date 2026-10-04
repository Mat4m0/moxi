import { createApp } from "vue";
import App from "./App.vue";
import { bridgeData, fixtureData } from "./launcher-data";
import "@moxi/ui/tokens.css";
import "@moxi/ui/components.css";
import "@moxi/ui/fonts.css";
import "./style.css";

createApp(App, {
  data: window.moxi ? bridgeData() : fixtureData(window.location.search),
  embedded: !!window.moxi,
}).mount("#app");

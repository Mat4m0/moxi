<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ResponseOf } from "@moxi/contracts";
const info = ref<ResponseOf<"app.info">>();
onMounted(async () => {
  info.value = await window.moxi.invoke("app.info", undefined);
});
function play() {
  void window.moxi.invoke("game.open", undefined);
}
</script>
<template>
  <main v-if="info">
    <h1>{{ info.productName }}</h1>
    <p>Version {{ info.version }}</p>
    <button @click="play">Play</button>
  </main>
</template>
<style>
body {
  margin: 0;
  font-family: system-ui, sans-serif;
}
#app {
  min-height: 100vh;
  display: grid;
  place-items: center;
}
main {
  text-align: center;
}
button {
  font: inherit;
  padding: 0.5rem 1.5rem;
  cursor: pointer;
}
</style>

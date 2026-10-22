<script setup>
import { inject, getCurrentInstance } from "vue";
import { useFact } from "@moxi/sdk";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = Symbol.for("moxi.session");
const target = useFact("game.target");
const sidBefore = inject(KEY).sid;
await delay(target.value.delayMs ?? 5);
// compiled `await` goes through withAsyncContext, which restores the instance
const instAfter = getCurrentInstance() !== null;
const sidAfter = inject(KEY)?.sid ?? "none";
const factAfter = target.value.name;
</script>

<template>
  <ui-text :text="`sfc sid=${sidBefore}/${sidAfter} inst=${instAfter} fact=${factAfter}`" />
</template>

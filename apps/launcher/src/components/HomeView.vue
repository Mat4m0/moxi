<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, Newspaper, Pause, Play, X } from "lucide-vue-next";
import type { LauncherData, NewsStory } from "../launcher-data";
import BaseModal from "./BaseModal.vue";
const props = defineProps<{ data: LauncherData }>();
const state = props.data.state;
const index = ref(0);
const filter = ref<"all" | NewsStory["source"]>("all");
const article = ref<NewsStory | null>(null);
const hovered = ref(false);
const focused = ref(false);
const hidden = ref(false);
const reduced = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
let media: MediaQueryList | undefined;
const featured = computed(() => {
  const stories = state.value.news.stories.filter((story) => story.featured);
  return stories.length ? stories : state.value.news.stories;
});
const story = computed(() => featured.value[index.value % Math.max(1, featured.value.length)]);
const visible = computed(() =>
  state.value.news.stories.filter(
    (story) => filter.value === "all" || story.source === filter.value,
  ),
);
const rotating = computed(
  () =>
    state.value.preferences.content.autoRotateNews &&
    !hovered.value &&
    !focused.value &&
    !hidden.value &&
    !reduced.value &&
    featured.value.length > 1,
);
const filters = [
  { id: "all", label: "All" },
  { id: "game", label: "Game" },
  { id: "event", label: "Events" },
  { id: "launcher", label: "GWonMac" },
] as const;
const sources = { game: "Guild Wars", event: "Event", launcher: "GWonMac" };
function restart() {
  clearInterval(timer);
  timer = undefined;
  if (rotating.value) timer = setInterval(() => move(1), 12_000);
}
function move(direction: number) {
  if (!featured.value.length) return;
  index.value = (index.value + direction + featured.value.length) % featured.value.length;
  restart();
}
function motion(event: MediaQueryListEvent | MediaQueryList) {
  reduced.value = event.matches;
}
function visibility() {
  hidden.value = document.hidden;
}
function blur(event: FocusEvent) {
  focused.value =
    event.currentTarget instanceof HTMLElement &&
    event.relatedTarget instanceof Node &&
    event.currentTarget.contains(event.relatedTarget);
}
function date(value: string, month: "long" | "short" = "long") {
  return new Date(value).toLocaleDateString(undefined, { month, day: "numeric" });
}
watch(rotating, restart);
watch(featured, () => {
  index.value = 0;
  restart();
});
onMounted(() => {
  media = window.matchMedia("(prefers-reduced-motion: reduce)");
  motion(media);
  hidden.value = document.hidden;
  media.addEventListener("change", motion);
  document.addEventListener("visibilitychange", visibility);
  restart();
});
onBeforeUnmount(() => {
  clearInterval(timer);
  media?.removeEventListener("change", motion);
  document.removeEventListener("visibilitychange", visibility);
});
</script>
<template>
  <section
    class="hero-panel news-hero"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focused = true"
    @focusout="blur"
  >
    <div v-if="story" class="hero-copy news-hero-copy">
      <span class="hero-kicker"
        >{{
          story.source === "game"
            ? "Guild Wars update"
            : story.source === "event"
              ? "Upcoming event"
              : story.channel === "beta"
                ? "GWonMac Beta"
                : "GWonMac release"
        }}<small v-if="story.channel === 'beta'">Beta</small></span
      >
      <Transition name="news-fade" mode="out-in"
        ><div :key="story.id">
          <h1>{{ story.title }}</h1>
          <time class="hero-meta" :datetime="story.publishedAt">{{ date(story.publishedAt) }}</time>
          <p>{{ story.summary }}</p>
          <button v-if="story.action === 'article'" class="text-link" @click="article = story">
            Read release notes
          </button>
        </div></Transition
      >
      <div v-if="featured.length > 1" class="story-controls" aria-label="Featured news controls">
        <button aria-label="Previous story" @click="move(-1)"><ChevronLeft /></button
        ><span>{{ index + 1 }} / {{ featured.length }}</span
        ><button
          :aria-label="
            reduced
              ? 'Automatic story rotation paused for Reduced Motion'
              : state.preferences.content.autoRotateNews
                ? 'Pause automatic story rotation'
                : 'Resume automatic story rotation'
          "
          :aria-pressed="!state.preferences.content.autoRotateNews || reduced"
          :disabled="reduced"
          @click="data.rotateNews(!state.preferences.content.autoRotateNews)"
        >
          <Pause v-if="state.preferences.content.autoRotateNews || reduced" /><Play
            v-else
          /></button
        ><button aria-label="Next story" @click="move(1)"><ChevronRight /></button
        ><small v-if="reduced" class="motion-note">Reduced Motion</small>
      </div>
    </div>
    <div v-else class="hero-copy">
      <h1>News will appear here.</h1>
      <p>Connect to the internet to refresh your news.</p>
    </div>
  </section>
  <section class="home-panel">
    <div class="segmented home-tabs" role="tablist" aria-label="Home content">
      <button id="news-tab" role="tab" aria-selected="true" aria-controls="news-panel">
        <Newspaper />News
      </button>
    </div>
    <div id="news-panel" role="tabpanel" aria-labelledby="news-tab">
      <div class="news-panel-head">
        <div>
          <h2>Latest news</h2>
          <span v-if="state.news.status === 'offline'" class="offline-note"
            >Saved news · offline</span
          >
        </div>
      </div>
      <div class="news-filters" role="group" aria-label="Filter news">
        <button
          v-for="item in filters"
          :key="item.id"
          :class="{ active: filter === item.id }"
          :aria-pressed="filter === item.id"
          @click="filter = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <div v-if="!visible.length" class="news-status">No news matches this filter.</div>
      <div v-else class="news-feed-list">
        <component
          :is="item.action === 'article' ? 'button' : 'div'"
          v-for="item in visible"
          :key="item.id"
          class="news-row"
          @click="item.action === 'article' && (article = item)"
          ><span class="story-source" :class="`source-${item.source}`"
            >{{ sources[item.source] }}<small v-if="item.channel === 'beta'">Beta</small></span
          ><span class="story-copy"
            ><strong>{{ item.title }}</strong
            ><span>{{ item.summary }}</span></span
          ><time :datetime="item.publishedAt">{{ date(item.publishedAt, "short") }}</time
          ><span v-if="item.action === 'article'" class="row-action" aria-hidden="true"
            >Read</span
          ></component
        >
      </div>
    </div>
  </section>
  <BaseModal v-if="article" labelledby="news-article-title" wide @close="article = null"
    ><article class="news-article">
      <header>
        <div>
          <span class="news-kicker"
            >GWonMac · {{ article.channel === "beta" ? "Beta" : "Release" }}</span
          >
          <h1 id="news-article-title">{{ article.title }}</h1>
          <time :datetime="article.publishedAt">{{
            new Date(article.publishedAt).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          }}</time>
        </div>
        <button
          class="icon-button"
          aria-label="Close release notes"
          autofocus
          @click="article = null"
        >
          <X />
        </button>
      </header>
      <div class="article-body">
        <template v-for="(block, blockIndex) in article.body" :key="blockIndex"
          ><h2 v-if="block.type === 'heading'">{{ block.text }}</h2>
          <ul v-else-if="block.type === 'list'">
            <li v-for="item in block.items" :key="item">{{ item }}</li>
          </ul>
          <p v-else>{{ block.text }}</p></template
        >
      </div>
    </article></BaseModal
  >
</template>

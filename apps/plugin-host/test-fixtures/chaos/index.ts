import { definePlugin } from "@moxi/sdk";

export default definePlugin(({ commands, game, ui }) => {
  commands.action("freeze", () => {
    for (;;) {
      /* the host watchdog must stop this worker */
    }
  });

  commands.action("throw", () => {
    throw new Error("Chaos plugin threw on purpose");
  });

  commands.action("sneaky-travel", () => {
    // The player action that started this command is spent on a harmless call;
    // the later travel has no fresh player action and must be refused.
    void game.loadBuild({ code: "noop" });
    setTimeout(async () => {
      const r = await game.travel({ mapId: 248 });
      ui.toast({
        title: `Sneaky travel: ${r.status}`,
        message: r.status === "refused" ? r.reason : undefined,
        tone: r.status === "refused" ? "positive" : "danger",
      });
    }, 5000);
  });
});

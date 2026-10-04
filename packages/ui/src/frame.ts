const bodyUrl = new URL("./assets/frame/body.png", import.meta.url).href;
const headerUrl = new URL("./assets/frame/header.png", import.meta.url).href;

export function attachClassicFrame(panel: HTMLElement): () => void {
  const canvas = document.createElement("canvas");
  canvas.className = "ui-frame-artwork";
  canvas.setAttribute("aria-hidden", "true");
  panel.prepend(canvas);
  panel.classList.add("ui-art-frame");
  const body = new Image(),
    header = new Image();
  body.src = bodyUrl;
  header.src = headerUrl;
  let stopped = false;
  function draw() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const px = (value: number) => Math.round(value * (window.devicePixelRatio || 1));
    canvas.width = px(bounds.width);
    canvas.height = px(bounds.height);
    const context = canvas.getContext("2d");
    if (!context) return;
    const sourceX = [0, 28, 96, 128],
      sourceY = [0, 28, 98, 128];
    const x = [
      px(2),
      px(2) + px(28 * 1.7),
      canvas.width + px(2) - px(32 * 1.7),
      canvas.width + px(2),
    ];
    const y = [
      px(24 * 1.7),
      px(24 * 1.7) + px(28 * 1.2),
      canvas.height - px(30 * 1.2),
      canvas.height,
    ];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const sx = sourceX[col]!,
          sy = sourceY[row]!;
        const sw = sourceX[col + 1]! - sx,
          sh = sourceY[row + 1]! - sy;
        const height = y[row + 1]! - y[row]!;
        if (row === 0 && col !== 1) {
          for (let line = 0; line < height; line++) {
            const shift = Math.round(
              px(col === 0 ? -7 : -1) * (1 - line / Math.max(1, height - 1)),
            );
            const start = x[col]! + (col === 0 ? shift : 0);
            const end = x[col + 1]! + (col === 2 ? shift : 0);
            context.drawImage(
              body,
              sx,
              sy + (line * sh) / height,
              sw,
              sh / height,
              start,
              y[row]! + line,
              end - start,
              1,
            );
          }
        } else {
          context.drawImage(body, sx, sy, sw, sh, x[col]!, y[row]!, x[col + 1]! - x[col]!, height);
        }
      }
    }
    // Clear the source's translucent centre so panel opacity paints only once.
    context.clearRect(px(18), px(46), canvas.width - px(36), canvas.height - px(62));
    const headX = [0, 20, 108, 128],
      headDest = [0, px(34), canvas.width - px(34), canvas.width];
    for (let col = 0; col < 3; col++)
      context.drawImage(
        header,
        headX[col]!,
        5,
        headX[col + 1]! - headX[col]!,
        27,
        headDest[col]!,
        0,
        headDest[col + 1]! - headDest[col]!,
        px(27 * 1.7),
      );
  }
  const observer = new ResizeObserver(draw);
  let ratio: MediaQueryList | undefined;
  function watchRatio() {
    ratio?.removeEventListener("change", watchRatio);
    ratio = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    ratio.addEventListener("change", watchRatio);
    draw();
  }
  void Promise.all([body.decode(), header.decode()])
    .then(() => {
      if (stopped) return;
      observer.observe(canvas);
      window.addEventListener("resize", draw);
      watchRatio();
    })
    .catch(() => {
      panel.classList.remove("ui-art-frame");
      canvas.remove();
    });
  return () => {
    stopped = true;
    observer.disconnect();
    ratio?.removeEventListener("change", watchRatio);
    window.removeEventListener("resize", draw);
    panel.classList.remove("ui-art-frame");
    canvas.remove();
  };
}

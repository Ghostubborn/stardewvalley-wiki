/* 一次点击播放/暂停；每次进入页面关闭，首次播放才加载本地音轨。 */
(function () {
  "use strict";
  const audio = document.getElementById("background-music");
  const button = document.getElementById("music-toggle");
  const label = document.getElementById("music-label");
  let requested = false;
  let requestId = 0;
  audio.volume = 0.25;

  function render(playing = false, loading = false) {
    button.setAttribute("aria-pressed", String(playing));
    button.setAttribute("aria-busy", String(loading));
    button.title = loading ? "正在缓冲，点击停止" : `${playing ? "暂停" : "播放"}${audio.dataset.title}`;
    label.textContent = loading ? "加载中" : playing ? "音乐开" : "音乐关";
  }
  function stop() {
    requested = false;
    requestId++;
    audio.pause();
    render();
  }
  function failed() {
    if (!requested) return;
    stop();
    window.App?.toast("背景音乐暂时无法播放，点击音乐按钮可重试。");
  }
  button.addEventListener("click", async () => {
    if (requested) { stop(); return; }
    requested = true;
    const id = ++requestId;
    render(false, true);
    // 用户点击后由浏览器尽快缓冲完整本地音轨，后续循环无需请求外站。
    audio.preload = "auto";
    if (!audio.hasAttribute("src") || audio.error) audio.src = audio.dataset.src;
    try {
      await audio.play();
      if (id !== requestId || !requested) return;
      render(true);
    } catch (_) {
      // 用户在加载期间关闭会取消 play()；旧请求不影响新状态。
      if (id === requestId) failed();
    }
  });
  audio.addEventListener("playing", () => {
    if (!requested) { audio.pause(); return; }
    render(true);
  });
  audio.addEventListener("waiting", () => { if (requested) render(false, true); });
  audio.addEventListener("stalled", () => { if (requested && audio.readyState < 3) render(false, true); });
  audio.addEventListener("pause", () => {
    if (audio.paused) { requested = false; requestId++; render(); }
  });
  audio.addEventListener("error", failed);
  window.addEventListener("pagehide", stop);
  render();
})();

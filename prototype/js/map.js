/* 山谷地图（Canvas 2D）：基础地形保留，名称与点位按展示范围保护。 */
(function () {
  "use strict";
  const App = window.App;
  const { D } = App;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  const canvas = document.getElementById("map");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;
  const cam = { x: 200, y: 122, z: 3 };
  const maps = {};
  let mapKey = "valley";
  let season = App.state.cond.season;
  let seasonFade = null;
  let dirty = true;
  let lastDraw = 0;
  let hits = [];
  let hover = null;
  let selection = null; // { type, id }
  let focusedPoint = null;
  let related = [];     // 额外高亮的地点名
  const icons = new Map();
  const particles = [];
  let flash = 0, nextFlash = 0;
  let tween = null;

  // ———————————————————— 颜色工具 ————————————————————
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  const hash = (x, y) => {
    let n = x * 374761393 + y * 668265263;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // 每个季节预先重新配色一次（400×244，很快）
  function recolor(src, key) {
    const w = src.width, h = src.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const o = out.getContext("2d");
    o.drawImage(src, 0, 0);
    if (key === "summer") return out;
    const data = o.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const p = i / 4, x = p % w, y = (p - x) / w;
      if (x < 5 || y < 5 || x >= w - 5 || y >= h - 5) continue; // 保留木框
      let [hh, s, l] = rgb2hsl(px[i], px[i + 1], px[i + 2]);
      const green = hh >= 62 && hh <= 172 && s > 0.14 && l > 0.05 && l < 0.92;
      const water = hh >= 180 && hh <= 250 && s > 0.18;
      const sand = hh >= 22 && hh <= 60 && l > 0.5;
      if (key === "fall" && green) {
        const n = hash(x >> 3, y >> 3);
        if (l > 0.42) { hh = 38 + n * 12; s = clamp(s * 0.95 + 0.06, 0, 1); l = l * 0.93; }
        else { hh = 12 + n * 26; s = clamp(s * 1.1 + 0.1, 0, 1); l = l * 0.96; }
      } else if (key === "winter") {
        if (green) { hh = 208; s = s * 0.18; l = clamp(0.36 + l * 0.72, 0, 0.96); }
        else if (water) { s *= 0.62; l = clamp(l * 1.06 + 0.06, 0, 0.93); }
        else if (sand) { s *= 0.4; l = clamp(l * 0.8 + 0.2, 0, 0.96); }
        else { s *= 0.7; l = clamp(l * 0.94 + 0.05, 0, 0.95); }
      } else if (key === "spring" && green) {
        hh -= 9; s = clamp(s * 1.05, 0, 1); l = clamp(l * 1.05 + 0.01, 0, 1);
      } else continue;
      const [r, g, b] = hsl2rgb(hh, s, l);
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
    o.putImageData(data, 0, 0);
    return out;
  }

  function loadMap(key) {
    const def = D.maps[key];
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        const base = document.createElement("canvas");
        base.width = im.width; base.height = im.height;
        base.getContext("2d").drawImage(im, 0, 0);
        const seasons = {};
        for (const s of App.SEASONS) seasons[s] = recolor(base, s);
        maps[key] = { w: def.w, h: def.h, seasons };
        resolve();
      };
      im.src = def.src;
    });
  }

  function icon(name) {
    if (!name) return null;
    let im = icons.get(name);
    if (!im) {
      im = new Image();
      im.onload = () => { dirty = true; };
      im.src = App.iconSrc(name);
      icons.set(name, im);
    }
    return im.complete && im.naturalWidth ? im : null;
  }

  // ———————————————————— 相机 ————————————————————
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    dirty = true;
  }
  const cover = () => { const m = maps[mapKey] || { w: 400, h: 244 }; return Math.max(W / m.w, H / m.h); };
  const contain = () => { const m = maps[mapKey] || { w: 400, h: 244 }; return Math.min(W / m.w, H / m.h) * 0.6; };
  function clampCam() {
    const m = maps[mapKey] || { w: 400, h: 244 };
    cam.z = clamp(cam.z, contain(), 12);
    const hw = W / 2 / cam.z, hh = H / 2 / cam.z;
    // 地图比视口小时允许偏移；比视口大时允许多拖出面板的宽度，让边缘地点能移到面板之外
    const pad = App.mapPad || { left: 0, right: 0, bottom: 0 };
    const slackX = Math.max(0, hw - m.w / 2), slackY = Math.max(0, hh - m.h / 2);
    cam.x = hw * 2 >= m.w ? clamp(cam.x, m.w / 2 - slackX, m.w / 2 + slackX) : clamp(cam.x, hw - pad.left / cam.z, m.w - hw + pad.right / cam.z);
    cam.y = hh * 2 >= m.h ? clamp(cam.y, m.h / 2 - slackY, m.h / 2 + slackY) : clamp(cam.y, hh - (pad.top || 0) / cam.z, m.h - hh + pad.bottom / cam.z);
  }
  const toScreen = (x, y) => [(x - cam.x) * cam.z + W / 2, (y - cam.y) * cam.z + H / 2];
  const toWorld = (sx, sy) => [(sx - W / 2) / cam.z + cam.x, (sy - H / 2) / cam.z + cam.y];
  // 整张地图放进面板之间的可见区域；缩放取整到设备像素，像素画不会糊
  function fit() {
    const m = maps[mapKey] || { w: 400, h: 244 };
    const narrow = W <= 760;
    const free = Math.max(320, (App.mapFreeW || W) - 24);
    // 竖屏手机：按高度铺满，左右拖动；桌面：整张地图放进面板之间
    const z = narrow ? Math.max((H - 300) / m.h, W / m.w) : Math.min(free / m.w, (H - 24) / m.h);
    cam.z = Math.max(contain(), Math.floor(z * DPR * 2) / (DPR * 2));
    cam.x = narrow ? (mapKey === "valley" ? 235 : m.w / 2) : m.w / 2 - (App.mapInsetX || 0) / cam.z;
    cam.y = m.h / 2 - (App.mapInsetY || 0) / cam.z;
    clampCam();
    dirty = true;
  }
  function tweenCam(target) {
    if (reduceMotion.matches) { Object.assign(cam, target); clampCam(); dirty = true; return; }
    tween = { from: { ...cam }, to: target, t0: performance.now(), dur: 650 };
  }
  // 让地图上的 (x, y) 出现在可见区域中央（避开左右面板）
  function flyTo(x, y, z) {
    const nz = clamp(z || cam.z, contain(), 12);
    tweenCam({ x: x - (App.mapInsetX || 0) / nz, y: y - (App.mapInsetY || 0) / nz, z: nz });
  }
  // 以屏幕点为中心缩放：该点下的地图位置保持不动
  function zoomAround(sx, sy, nz) {
    nz = clamp(nz, contain(), 12);
    const [wx, wy] = toWorld(sx, sy);
    tweenCam({ x: wx - (sx - W / 2) / nz, y: wy - (sy - H / 2) / nz, z: nz });
  }

  // ———————————————————— 条件 → 画面参数 ————————————————————
  function darkness() {
    const { time, season: s } = App.state.cond;
    const start = s === "winter" ? 1700 : s === "summer" ? 1830 : 1800;
    const k = clamp((App.timeToMinutes(time) - App.timeToMinutes(start)) / 150, 0, 1);
    return k * 0.7;
  }
  function resetParticles() {
    particles.length = 0;
    flash = 0;
    nextFlash = 0;
    const w = App.state.cond.weather;
    if (!App.conditionsActive() || !App.state.fx || reduceMotion.matches) return;
    const area = (W * H) / (1440 * 900);
    const count = { rain: 240, storm: 380, snow: 170, wind: 46 }[w] || 0;
    for (let i = 0; i < Math.round(count * area); i++) particles.push(spawn(w, true));
  }
  function spawn(w, initial) {
    const p = { x: Math.random() * W, y: initial ? Math.random() * H : -20, s: 0.6 + Math.random() * 0.8, ph: Math.random() * 6.28 };
    if (w === "wind") { p.x = initial ? Math.random() * W : -10; p.y = Math.random() * H; }
    return p;
  }

  // ———————————————————— 绘制 ————————————————————
  function frame(t) {
    requestAnimationFrame(frame);
    const animating = tween || particles.length || flash > 0 || seasonFade;
    if (!dirty && !animating) return;
    if (!dirty && t - lastDraw < 1000 / 60 - 0.5) return;
    if (App.state.view !== "map") return;
    lastDraw = t;
    dirty = false;
    if (tween) {
      const k = Math.min(1, (t - tween.t0) / tween.dur);
      const e = 1 - Math.pow(1 - k, 3);
      cam.x = tween.from.x + (tween.to.x - tween.from.x) * e;
      cam.y = tween.from.y + (tween.to.y - tween.from.y) * e;
      cam.z = tween.from.z + (tween.to.z - tween.from.z) * e;
      clampCam();
      if (k >= 1) tween = null;
    }
    draw(t);
  }

  function draw(t) {
    const m = maps[mapKey];
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#2a1416";
    ctx.fillRect(0, 0, W, H);
    if (!m) return;
    const [ox, oy] = toScreen(0, 0);
    const mw = m.w * cam.z, mh = m.h * cam.z;
    ctx.imageSmoothingEnabled = false;

    // 1. 底图：默认原画；打开示意效果时按季节重新配色（交叉淡入）
    const fx = App.conditionsActive() && !!App.state.fx;
    if (!fx) {
      ctx.drawImage(m.seasons.summer, ox, oy, mw, mh);
      seasonFade = null;
    } else if (seasonFade) {
      const k = Math.min(1, (t - seasonFade.t0) / 700);
      ctx.drawImage(m.seasons[seasonFade.from], ox, oy, mw, mh);
      ctx.globalAlpha = k;
      ctx.drawImage(m.seasons[season], ox, oy, mw, mh);
      ctx.globalAlpha = 1;
      if (k >= 1) seasonFade = null;
    } else {
      ctx.drawImage(m.seasons[season], ox, oy, mw, mh);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, mw, mh);
    ctx.clip();

    // 2. 天气色调与夜晚；不按地点范围覆盖基础地形。
    const w = App.state.cond.weather;
    if (fx && (w === "rain" || w === "storm")) {
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = w === "storm" ? "rgb(150,158,180)" : "rgb(196,202,216)";
      ctx.fillRect(ox, oy, mw, mh);
    }
    const dk = fx ? darkness() : 0;
    if (dk > 0) {
      ctx.globalCompositeOperation = "multiply";
      const c = [255 - (255 - 46) * dk, 255 - (255 - 58) * dk, 255 - (255 - 118) * dk].map(Math.round);
      ctx.fillStyle = `rgb(${c})`;
      ctx.fillRect(ox, oy, mw, mh);
      ctx.globalCompositeOperation = "lighter";
      for (const l of D.locations) {
        if (l.map !== mapKey || l.x == null || !(l.occ?.length || App.BUSINESSES.has(l.p))) continue;
        if (!App.spoilers.mapPoint({ type: "location", id: l.p }, [l.x, l.y, l.map])) continue;
        const [sx, sy] = toScreen(l.x, l.y);
        const r = 10 * cam.z;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, `rgba(255,186,96,${0.55 * dk})`);
        g.addColorStop(1, "rgba(255,186,96,0)");
        ctx.fillStyle = g;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    if (fx && w === "snow") {
      ctx.fillStyle = "rgba(235,242,255,0.10)";
      ctx.fillRect(ox, oy, mw, mh);
    }
    ctx.restore();

    // 3. 标记
    hits = [];
    drawPins(t);

    // 4. 粒子与闪电
    if (fx) drawParticles(t, w);
    if (flash > 0) {
      ctx.fillStyle = `rgba(235,240,255,${flash})`;
      ctx.fillRect(0, 0, W, H);
      flash = Math.max(0, flash - 0.04);
    }
  }

  function pixelText(text, x, y, opts = {}) {
    ctx.font = `${opts.size || 12}px "SDV Pixel", "PingFang SC", sans-serif`;
    ctx.textAlign = opts.align || "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = opts.stroke || "rgba(91,43,42,.95)";
    ctx.strokeText(text, Math.round(x), Math.round(y));
    ctx.fillStyle = opts.fill || "#fff7d3";
    ctx.fillText(text, Math.round(x), Math.round(y));
  }

  const markerButtons = new Map();
  let visibleMarkers = [];
  function activateMarker(marker) {
    if (marker.entries.length === 1) App.select(marker.entries[0].ref, { from: "map" });
    else App.openMapPlaces(marker.points.map(p => p.id));
  }
  function syncKeyboardMarkers(markers) {
    const root = document.getElementById("map-keyboard");
    const wanted = new Set(markers.map(m => m.id));
    for (const [id, button] of markerButtons) if (!wanted.has(id)) { button.remove(); markerButtons.delete(id); }
    markers.forEach((marker, index) => {
      let button = markerButtons.get(marker.id);
      if (!button) {
        button = document.createElement("button"); button.type = "button"; button.className = "map-key";
        button.addEventListener("click", () => { const current = visibleMarkers.find(m => m.id === button.dataset.id); if (current) activateMarker(current); });
        button.addEventListener("focus", () => { hover = { key: button.dataset.id }; dirty = true; });
        button.addEventListener("blur", () => { hover = null; dirty = true; });
        button.addEventListener("keydown", e => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          const list = [...root.children], i = list.indexOf(button);
          list[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + list.length) % list.length]?.focus();
        });
        markerButtons.set(marker.id, button); root.append(button);
      }
      button.dataset.id = marker.id;
      button.tabIndex = index === 0 ? 0 : -1;
      button.setAttribute("aria-label", `${marker.title}，${marker.aggregate ? "聚合标记，" : App.mapContents.positionNote(marker.points[0]) + "，"}${marker.entries.length} 条资料，${marker.entries.length > 1 ? "查看列表" : "查看详情"}`);
      button.style.left = `${marker.x - 22}px`; button.style.top = `${marker.y - 22}px`;
    });
  }
  function drawPins(t) {
    const points = App.mapContents.points(mapKey).filter(p => {
      const [x, y] = toScreen(p.x, p.y); return x >= -22 && y >= -22 && x <= W + 22 && y <= H + 22;
    });
    // A badge sits above its anchor. Apply that offset BEFORE clustering, so
    // badge collision tests, keyboard targets and pointer hits agree.
    visibleMarkers = App.mapContents.cluster(points, (x, y) => {
      const [sx, sy] = toScreen(x, y); return [sx, sy - 28];
    }, W <= 760 ? 56 : 54);
    const selectedKey = selection && App.mapContents.refKey(selection);
    for (const marker of visibleMarkers) {
      const active = hover?.key === marker.id || marker.points.some(p => p.id === focusedPoint || p.entries.some(e => e.key === selectedKey));
      for (const point of marker.points) {
        const [x, y] = toScreen(point.x, point.y);
        const selected = point.id === focusedPoint || point.entries.some(e => e.key === selectedKey);
        if (!marker.aggregate || active) {
          ctx.beginPath(); ctx.moveTo(marker.x, marker.y + 17); ctx.lineTo(x, y);
          ctx.lineWidth = 3; ctx.strokeStyle = "#5b2b2a"; ctx.stroke();
          ctx.lineWidth = 1; ctx.strokeStyle = "#fff7d3"; ctx.stroke();
        }
        // These dots always stay attached to the original map coordinates.
        ctx.fillStyle = "#5b2b2a"; ctx.fillRect(Math.round(x) - 4, Math.round(y) - 4, 8, 8);
        ctx.fillStyle = selected ? "#f7ba00" : "#fff7d3"; ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
        if (selected) ring(x, y, 9, "#fff7d3");
      }
    }
    for (const marker of visibleMarkers) {
      const selected = marker.entries.find(e => e.key === selectedKey);
      const primary = selected || marker.entries.find(e => e.kind === "location" && !e.concealed && e.icon)
        || marker.entries.find(e => !e.concealed && e.icon) || marker.entries[0];
      const sx = Math.round(marker.x), sy = Math.round(marker.y), many = marker.entries.length > 1;
      const relatedPoint = marker.entries.some(e => related.includes(e.label));
      if (selected || relatedPoint) ring(sx, sy, 21, selected ? "#fff7d3" : "#f7ba00");
      if (!many && primary.concealed) {
        ctx.fillStyle = "#5b2b2a"; ctx.fillRect(sx - 9, sy - 9, 18, 18);
        ctx.fillStyle = "#fbebc2"; ctx.fillRect(sx - 7, sy - 7, 14, 14);
        ctx.fillStyle = "#853605"; ctx.fillRect(sx - 4, sy - 1, 8, 6);
        ctx.fillRect(sx - 3, sy - 4, 2, 4); ctx.fillRect(sx + 1, sy - 4, 2, 4); ctx.fillRect(sx - 2, sy - 5, 4, 2);
      } else {
        ctx.fillStyle = "#5b2b2a"; ctx.fillRect(sx - 17, sy - 17, 34, 34);
        ctx.fillStyle = "#dc7b05"; ctx.fillRect(sx - 15, sy - 15, 30, 30);
        ctx.fillStyle = "#fbebc2"; ctx.fillRect(sx - 13, sy - 13, 26, 26);
        const im = marker.aggregate ? null : icon(primary.icon);
        if (marker.aggregate) {
          // A centroid is a list shortcut, never a claimed position for one
          // particular shop, resident or fish.
          ctx.fillStyle = "#5b2b2a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.font = 'bold 15px "PingFang SC", sans-serif'; ctx.fillText(String(marker.points.length), sx, sy - 4);
          ctx.font = '10px "SDV Pixel", sans-serif'; ctx.fillText("处", sx, sy + 8);
        } else if (im) {
          const scale = Math.min(24 / im.naturalWidth, 24 / im.naturalHeight);
          const w = Math.max(1, Math.round(im.naturalWidth * scale)), h = Math.max(1, Math.round(im.naturalHeight * scale));
          ctx.drawImage(im, sx - Math.floor(w / 2), sy - Math.floor(h / 2), w, h);
        } else {
          ctx.fillStyle = "#853605"; ctx.fillRect(sx - 6, sy - 6, 12, 12); ctx.fillStyle = "#fbebc2"; ctx.fillRect(sx - 3, sy - 3, 6, 6);
        }
      }
      if (many && !marker.aggregate) {
        const label = marker.entries.length > 99 ? "99+" : String(marker.entries.length);
        ctx.font = 'bold 12px "PingFang SC", sans-serif'; const bw = Math.max(18, Math.ceil(ctx.measureText(label).width) + 8);
        ctx.fillStyle = "#5b2b2a"; ctx.fillRect(sx + 4, sy + 5, bw, 18);
        ctx.fillStyle = "#fff7d3"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, sx + 4 + bw / 2, sy + 14);
      }
      if (selected || hover?.key === marker.id) pixelText(many ? marker.title : primary.label, sx, sy - 27);
      hits.push({ x: sx, y: sy, r: W <= 760 ? 27 : 24, box: [sx - 20, sy - 20, sx + 34, sy + 26], key: marker.id, marker,
        tip: { title: marker.title, why: marker.aggregate ? `${marker.entries.length} 条资料 · 小点表示各地点，点击选择并定位`
          : primary.concealed ? "名称与条件已收起，点击选择查看" : `${App.mapContents.positionNote(marker.points[0])} · ${many ? marker.entries.length + " 条资料，点击查看" : primary.subtitle || "点击查看资料"}` } });
    }
    syncKeyboardMarkers(visibleMarkers);
  }
  function ring(x, y, r, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  }

  function drawParticles(t, w) {
    if (!particles.length) return;
    if (w === "rain" || w === "storm") {
      ctx.strokeStyle = w === "storm" ? "rgba(205,218,255,.6)" : "rgba(200,214,250,.5)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const p of particles) {
        const sp = (w === "storm" ? 16 : 11) * p.s;
        p.x += -sp * 0.28; p.y += sp;
        if (p.y > H || p.x < -20) Object.assign(p, spawn(w), { x: Math.random() * (W + 200) });
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + sp * 0.28 * 1.2, p.y - sp * 1.2);
      }
      ctx.stroke();
      if (w === "storm" && t > nextFlash) {
        if (nextFlash) flash = 0.55;
        nextFlash = t + 5000 + Math.random() * 6000;
      }
    } else if (w === "snow") {
      ctx.fillStyle = "rgba(250,252,255,.9)";
      for (const p of particles) {
        p.y += 0.9 * p.s; p.x += Math.sin(t / 900 + p.ph) * 0.4;
        if (p.y > H) Object.assign(p, spawn(w));
        const s = p.s > 1.1 ? 3 : 2;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
      }
    } else if (w === "wind") {
      const colors = season === "fall" ? ["#c8642a", "#e0a03a", "#9c4a1e"] : ["#f2a7c3", "#fbe1ea", "#c7e59a"];
      for (const p of particles) {
        p.x += 2.2 * p.s; p.y += Math.sin(t / 500 + p.ph) * 0.8 + 0.25;
        if (p.x > W + 10 || p.y > H) Object.assign(p, spawn(w), { x: -10, y: Math.random() * H });
        ctx.fillStyle = colors[Math.floor(p.ph) % 3];
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 4, 3);
      }
    }
  }

  // ———————————————————— 交互 ————————————————————
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  function hitAt(x, y) {
    let best = null, bd = Infinity;
    for (const h of hits) {
      const d = Math.hypot(h.x - x, h.y - y);
      const inside = h.box ? x >= h.box[0] && y >= h.box[1] && x <= h.box[2] && y <= h.box[3] : d <= h.r;
      if (inside && d < bd) { best = h; bd = d; }
    }
    return best;
  }
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    tween = null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z };
      drag = null;
    } else {
      drag = { x: e.offsetX, y: e.offsetY, cx: cam.x, cy: cam.y, moved: false };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.z = pinch.z * (d / pinch.d);
      clampCam();
      dirty = true;
      return;
    }
    if (drag) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        canvas.classList.add("dragging");
        cam.x = drag.cx - dx / cam.z;
        cam.y = drag.cy - dy / cam.z;
        clampCam();
        dirty = true;
        App.hideTip && App.hideTip();
        return;
      }
    }
    const h = hitAt(e.offsetX, e.offsetY);
    const key = h ? h.key || JSON.stringify(h.ref) : null;
    if (key !== (hover && hover.key)) {
      hover = h ? { ...h, key } : null;
      dirty = true;
    }
    canvas.classList.toggle("hovering", !!h);
    if (!App.showTip) return;
    if (h) App.showTip(h.tip, e.clientX, e.clientY);
    else App.hideTip();
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    canvas.classList.remove("dragging");
    if (drag && !drag.moved) {
      const h = hitAt(e.offsetX, e.offsetY);
      if (h) activateMarker(h.marker);
      else App.select(null);
    }
    drag = null;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", e => { pointers.delete(e.pointerId); pinch = null; drag = null; canvas.classList.remove("dragging"); });
  canvas.addEventListener("pointerleave", () => { hover = null; App.hideTip && App.hideTip(); dirty = true; });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    tween = null;
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 40 && !e.deltaX) {
      const [wx, wy] = toWorld(e.offsetX, e.offsetY);
      cam.z *= Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0022));
      clampCam();
      const [nx, ny] = toWorld(e.offsetX, e.offsetY);
      cam.x += wx - nx; cam.y += wy - ny;
    } else {
      cam.x += e.deltaX / cam.z;
      cam.y += e.deltaY / cam.z;
    }
    clampCam();
    dirty = true;
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => zoomAround(e.offsetX, e.offsetY, cam.z * 1.6));
  canvas.addEventListener("keydown", (e) => {
    const step = 40 / cam.z;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (k) { cam.x += k[0]; cam.y += k[1]; clampCam(); dirty = true; e.preventDefault(); }
  });
  canvas.tabIndex = 0;

  // ———————————————————— 对外接口 ————————————————————
  function onState(reason) {
    hover = null;
    if (mapKey === "island" && !App.spoilers.area("ginger_island")) { mapKey = "valley"; fit(); }
    if (App.state.cond.season !== season) {
      seasonFade = reduceMotion.matches ? null : { from: season, t0: performance.now() };
      season = App.state.cond.season;
    }
    if (reason === "cond" && App.state.cond.weather !== onState.weather) {
      onState.weather = App.state.cond.weather;
      resetParticles();
    }
    if (reason === "fx" || reason === "cond") resetParticles();
    dirty = true;
  }

  App.map = {
    async init() {
      resize();
      await Promise.all([loadMap("valley"), loadMap("island")]);
      document.fonts && document.fonts.load('12px "SDV Pixel"').then(() => { dirty = true; });
      fit();
      onState.weather = App.state.cond.weather;
      resetParticles();
      App.on(onState);
      window.addEventListener("resize", () => { resize(); clampCam(); resetParticles(); });
      requestAnimationFrame(frame);
    },
    select(ref) {
      selection = ref && ["fish", "location", "villager", "page", "area"].includes(ref.type) ? ref : null;
      focusedPoint = null;
      dirty = true;
    },
    setRelated(names) { related = names || []; dirty = true; },
    focus(x, y, z) { flyTo(x, y, z || Math.max(cam.z, 5)); },
    focusPin(ref, point, z = 5.5) {
      if (!App.spoilers.mapPoint(ref, point)) return false;
      const [x, y, key] = point;
      const target = key;
      if (!maps[target]) return false;
      if (target !== mapKey) this.setMap(target);
      if (target !== mapKey) return false;
      focusedPoint = `${key}:${x}:${y}`;
      flyTo(x, y, z);
      return true;
    },
    locatePoint(id) {
      const point = App.mapContents.find(id);
      if (!point) return false;
      if (point.map !== mapKey) this.setMap(point.map);
      if (point.map !== mapKey) return false;
      focusedPoint = point.id;
      flyTo(point.x, point.y, Math.max(cam.z, 7));
      dirty = true;
      return true;
    },
    focusPlace(name) {
      if (!App.spoilers.canView({ type: "location", id: name })) return false;
      const l = App.locationByName.get(name);
      if (l && l.x != null) {
        return this.focusPin({ type: "location", id: name }, [l.x, l.y, l.map], Math.max(cam.z, 5));
      }
      const a = D.progression.areas.find((x) => x.title === name);
      if (a) {
        if (a.map !== mapKey) this.setMap(a.map);
        flyTo(a.x, a.y, Math.max(cam.z, 4.5));
        return true;
      }
      return false;
    },
    setMap(key) {
      if (key === "island" && !App.spoilers.area("ginger_island")) return;
      if (!maps[key] || key === mapKey) return;
      mapKey = key;
      fit();
      App.emit("map");
    },
    get mapKey() { return mapKey; },
    zoom(f) { zoomAround(W / 2 + (App.mapInsetX || 0), H / 2 + (App.mapInsetY || 0), cam.z * f); },
    fit() { fit(); },
    getMarkers() { return visibleMarkers; },
    redraw() { dirty = true; },
    resize() { resize(); clampCam(); },
  };
})();

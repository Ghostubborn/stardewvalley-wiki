"""大图转 WebP：Wiki 归档里的大地图、信息图和当作图标的大图转成 WebP 随站点发布。

派生图（文件名 = 原图去掉扩展名 + 后缀）：
  full   原尺寸。无损、有损各编一次：无损不超过有损的 1.5 倍时用无损（像素画一个像素都不变），
         否则用有损（照片、渐变多的信息图）；JPEG 原图只编有损。
  thumb  正文缩略图，宽 640 像素（显示 320 像素宽，高分屏也清楚），点开看原尺寸。
  icon   条目图标，长边 192 像素（详情页显示 48 像素，浏览页的地点图 80 像素）。
结果记在 data/build/webp.json（源文件散列 → 派生图和字节数），源文件、参数都没变就不重新编码。
需要 cwebp（brew install webp）。没有 cwebp、又没有可用的旧结果时 name() 返回 None，调用方照旧处理。
动图（GIF）不转：cwebp 只取第一帧。
"""

import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

SETTINGS = 1  # 编码参数改了就加一，旧结果全部重编
SUFFIX = {"full": ".webp", "thumb": ".thumb.webp", "icon": ".icon.webp"}
LOSSLESS_RATIO = 1.5


def _cwebp():
    found = shutil.which("cwebp")
    return found or next((p for p in ("/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp") if os.path.exists(p)), None)


class WebP:
    def __init__(self, root, out_dir):
        self.root, self.out_dir = root, out_dir
        self.path = os.path.join(root, "data", "build", "webp.json")
        saved = {}
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                saved = json.load(f)
        self.saved = saved.get("files", {}) if saved.get("settings") == SETTINGS else {}
        self.digests = {}  # 源文件 → sha1
        self.used = {}     # 派生图文件名 → (源文件, 种类)
        self.done = {}     # (源文件, 种类) → [派生图文件名, 字节数]
        self.jobs = {}     # (源文件, 种类) → 编码任务
        self.cwebp = _cwebp()
        self.pool = None

    def name(self, meta, kind):
        """归档图片（images.json 的一项）的派生图文件名；做不出来时返回 None。"""
        file = meta["file"]
        if file.lower().endswith(".gif"):
            return None
        out = os.path.splitext(file)[0] + SUFFIX[kind]
        owner = self.used.get(out)
        if owner and owner != (file, kind):
            raise ValueError(f"WebP 派生图重名：{out}（{owner[0]} 与 {file}）")
        key = (file, kind)
        if key in self.done or key in self.jobs:
            return out
        src = os.path.join(self.root, meta["path"])
        if file not in self.digests:
            with open(src, "rb") as f:
                self.digests[file] = hashlib.sha1(f.read()).hexdigest()
        old = self.saved.get(file, {})
        cached = old.get(kind) if old.get("sha1") == self.digests[file] else None
        dest = os.path.join(self.out_dir, out)
        if cached and cached[0] == out and os.path.isfile(dest) and os.path.getsize(dest) == cached[1]:
            self.done[key] = cached
        elif self.cwebp:
            self.pool = self.pool or concurrent.futures.ThreadPoolExecutor(max_workers=os.cpu_count() or 4)
            self.jobs[key] = self.pool.submit(self._encode, src, meta, kind, dest)
        else:
            return None
        self.used[out] = key
        return out

    def _encode(self, src, meta, kind, dest):
        w, h = meta.get("w") or 0, meta.get("h") or 0
        with tempfile.TemporaryDirectory() as tmp:
            def encode(args, name):
                path = os.path.join(tmp, name)
                subprocess.run([self.cwebp, "-quiet", *args, src, "-o", path], check=True)
                return path
            if kind == "full":
                best = encode(["-q", "85", "-m", "6", "-sharp_yuv"], "lossy.webp")
                if not meta["file"].lower().endswith((".jpg", ".jpeg")):
                    lossless = encode(["-lossless", "-z", "9"], "lossless.webp")
                    if os.path.getsize(lossless) <= LOSSLESS_RATIO * os.path.getsize(best):
                        best = lossless
            elif kind == "thumb":
                best = encode(["-q", "80", "-m", "6", "-sharp_yuv", *(["-resize", "640", "0"] if w > 640 else [])], "thumb.webp")
            else:
                size = (["-resize", "192", "0"] if w >= h else ["-resize", "0", "192"]) if max(w, h) > 192 else []
                best = encode(["-q", "85", "-m", "6", "-sharp_yuv", *size], "icon.webp")
            os.makedirs(self.out_dir, exist_ok=True)
            shutil.copyfile(best, dest)
        return os.path.getsize(dest)

    def run(self, keep_others=False):
        """等编码做完，把本次用到的派生图记回 data/build/webp.json；返回派生图文件名。
        keep_others：单独生成条目正文时，图标等别处用到、文件还在的旧记录也留着。"""
        for (file, kind), job in self.jobs.items():
            out = os.path.splitext(file)[0] + SUFFIX[kind]
            self.done[(file, kind)] = [out, job.result()]
        self.jobs = {}
        if self.pool:
            self.pool.shutdown()
            self.pool = None
        files = {}
        if keep_others:
            for file, entry in self.saved.items():
                kinds = {k: v for k, v in entry.items() if k != "sha1" and os.path.isfile(os.path.join(self.out_dir, v[0]))
                         and os.path.getsize(os.path.join(self.out_dir, v[0])) == v[1]}
                if kinds:
                    files[file] = {"sha1": entry["sha1"], **kinds}
        for (file, kind), result in sorted(self.done.items()):
            entry = files.setdefault(file, {"sha1": self.digests[file]})
            if entry["sha1"] != self.digests[file]:
                entry.clear()
                entry["sha1"] = self.digests[file]
            entry[kind] = result
        files = dict(sorted(files.items()))
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump({"settings": SETTINGS, "files": files}, f, ensure_ascii=False, indent=1)
            f.write("\n")
        return sorted(self.used)

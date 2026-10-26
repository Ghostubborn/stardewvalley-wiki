"""统计 PNG 图片的主色（只用标准库）：python3 -I scripts/png_palette.py <图片>... [--top N]

用于从游戏原版界面截图里取色，校准原型的色板。
"""

import struct
import sys
import zlib
from collections import Counter


def decode(path):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG"
    pos, idat, palette, trns = 8, b"", None, None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
        elif kind == b"PLTE":
            palette = [tuple(chunk[i:i + 3]) for i in range(0, len(chunk), 3)]
        elif kind == b"tRNS":
            trns = chunk
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length
    assert depth == 8 and interlace == 0, f"暂不支持位深 {depth} / 隔行扫描"
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(idat)
    stride = w * channels
    rows, prev = [], bytearray(stride)
    i = 0
    for _ in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - channels] if x >= channels else 0
            b = prev[x]
            c = prev[x - channels] if x >= channels else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    pixels = []
    for line in rows:
        for x in range(w):
            px = line[x * channels:(x + 1) * channels]
            if ctype == 3:
                rgb = palette[px[0]]
                alpha = trns[px[0]] if trns and px[0] < len(trns) else 255
            elif ctype == 6:
                rgb, alpha = tuple(px[:3]), px[3]
            elif ctype == 2:
                rgb, alpha = tuple(px), 255
            elif ctype == 4:
                rgb, alpha = (px[0],) * 3, px[1]
            else:
                rgb, alpha = (px[0],) * 3, 255
            if alpha > 200:
                pixels.append(rgb)
    return w, h, pixels


def main(argv):
    top = 12
    if "--top" in argv:
        top = int(argv[argv.index("--top") + 1])
        argv = argv[:argv.index("--top")] + argv[argv.index("--top") + 2:]
    for path in argv:
        w, h, pixels = decode(path)
        counts = Counter(pixels)
        total = len(pixels)
        print(f"{path} {w}x{h}")
        for rgb, n in counts.most_common(top):
            print(f"  #{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}  {n / total:6.1%}")


if __name__ == "__main__":
    main(sys.argv[1:])

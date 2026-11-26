"""
Makes the plenary constructivo used to test the guided LED flow: an elevation of five screens, left to right 3.5, 6,
14, 6 and 3.5 m wide, all 3.5 m high, with gaps of 1, 1.5, 1.5 and 1 m. Scale 1:100 on A3 landscape.

Writes two files with the same drawing:
- plenary-elevation.pdf: a vector PDF (text and rectangles, readable by the app);
- plenary-elevation.png: the same elevation as an image (nothing readable automatically).

Usage: python3 scripts/fixtures/make-plenary-drawing.py <output folder>
The PDF is written by hand (no library); the PNG needs Pillow.
"""
import os
import sys

PT_PER_M = 72 / 25.4 * 10  # 1:100, so 1 m on stage is 10 mm on paper
PAGE_W, PAGE_H = 1190.55, 841.89

SCREENS = [  # name, width m, width label, height label
    ("Side left", 3.5, "3,50 m", "3.50"),
    ("Wing left", 6.0, "6000", "3,50"),
    ("Centre", 14.0, "14.00", "3500"),
    ("Wing right", 6.0, "6,00", "3.5 m"),
    ("Side right", 3.5, "3.5", "3.50"),
]
GAPS = [(1.0, "1.00"), (1.5, "1,50 m"), (1.5, "1500"), (1.0, "1.0")]
HEIGHT_M = 3.5
SCREEN_TOP = 300.0  # top of the screens on the page, pt from the top


def layout():
    total = sum(s[1] for s in SCREENS) + sum(g[0] for g in GAPS)
    x = (PAGE_W - total * PT_PER_M) / 2
    rects = []
    for i, s in enumerate(SCREENS):
        w = s[1] * PT_PER_M
        rects.append((x, SCREEN_TOP, w, HEIGHT_M * PT_PER_M))
        x += w + (GAPS[i][0] * PT_PER_M if i < len(GAPS) else 0)
    return rects


def items():
    """Everything on the sheet, top-left origin in points: ('rect', x, y, w, h), ('line', x0, y0, x1, y1), ('text', x, y, size, s, anchor)."""
    out = [("rect", 20, 20, PAGE_W - 40, PAGE_H - 40)]
    # Title block: a box full of text, not a screen.
    tb = (PAGE_W - 300, PAGE_H - 120, 280, 100)
    out.append(("rect",) + tb)
    for i, t in enumerate(["PLENARY - ELEVATION", "Scale 1:100 on A3", "Dimensions in metres unless noted", "Test drawing for Playground Pixel Lab"]):
        out.append(("text", tb[0] + 10, tb[1] + 22 + i * 20, 10 if i else 13, t, "left"))
    rects = layout()
    bottom = SCREEN_TOP + HEIGHT_M * PT_PER_M
    floor = bottom + 1.5 * PT_PER_M
    out.append(("line", 40, floor, PAGE_W - 40, floor))
    out.append(("text", 44, floor - 6, 8, "FFL +0.00", "left"))
    dim_y = bottom + 18
    for (x, y, w, h), (name, _, wl, hl) in zip(rects, SCREENS):
        out.append(("rect", x, y, w, h))
        out.append(("text", x + w / 2, y + h / 2 + 4, 11, name, "center"))
        # Width: a dimension line under the screen, label under the line.
        out.append(("line", x, dim_y, x + w, dim_y))
        out.append(("line", x, dim_y - 4, x, dim_y + 4))
        out.append(("line", x + w, dim_y - 4, x + w, dim_y + 4))
        out.append(("text", x + w / 2, dim_y + 12, 8, wl, "center"))
    # Gaps: on the same dimension line, between the screens.
    for i, (_, gl) in enumerate(GAPS):
        a, b = rects[i], rects[i + 1]
        out.append(("text", (a[0] + a[2] + b[0]) / 2, dim_y + 12, 8, gl, "center"))
    # Heights: a vertical dimension line beside each screen (outside left for the first, right for the others).
    for i, ((x, y, w, h), (_, _, _, hl)) in enumerate(zip(rects, SCREENS)):
        side_x = x - 6 if i == 0 else x + w + 6
        out.append(("line", side_x, y, side_x, y + h))
        out.append(("line", side_x - 3, y, side_x + 3, y))
        out.append(("line", side_x - 3, y + h, side_x + 3, y + h))
        tx = side_x - 3 if i == 0 else side_x + 3
        out.append(("text", tx, y + h / 2 + 3, 7, hl, "right" if i == 0 else "left"))
    out.append(("text", PAGE_W / 2, 80, 16, "PLENARY - LED SCREENS ELEVATION", "center"))
    return out


HELV_WIDTHS = None


def text_width(s, size):
    # Helvetica advance widths for the characters used here (per 1000 em).
    w = {" ": 278, ",": 278, ".": 278, "-": 333, "+": 389, ":": 278}
    total = 0
    for ch in s:
        if ch.isdigit():
            total += 556
        elif ch in w:
            total += w[ch]
        elif ch.isupper():
            total += 667
        else:
            total += 500
    return total * size / 1000


def esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def write_pdf(path):
    ops = ["0 0 0 RG 0 0 0 rg"]
    for it in items():
        if it[0] == "rect":
            _, x, y, w, h = it
            ops.append(f"{0.6 if w < PAGE_W - 50 else 1.2:.1f} w {x:.2f} {PAGE_H - y - h:.2f} {w:.2f} {h:.2f} re S")
        elif it[0] == "line":
            _, x0, y0, x1, y1 = it
            ops.append(f"0.3 w {x0:.2f} {PAGE_H - y0:.2f} m {x1:.2f} {PAGE_H - y1:.2f} l S")
        else:
            _, x, y, size, s, anchor = it
            tw = text_width(s, size)
            tx = x - tw / 2 if anchor == "center" else x - tw if anchor == "right" else x
            ops.append(f"BT /F1 {size} Tf 1 0 0 1 {tx:.2f} {PAGE_H - y:.2f} Tm ({esc(s)}) Tj ET")
    stream = "\n".join(ops).encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Title (Plenary elevation - test drawing) /Producer (make-plenary-drawing.py) >>",
    ]
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    with open(path, "wb") as f:
        f.write(out)


def write_png(path, scale=2):
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (round(PAGE_W * scale), round(PAGE_H * scale)), "white")
    d = ImageDraw.Draw(img)
    fonts = {}

    def font(size):
        if size not in fonts:
            fonts[size] = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", round(size * scale))
        return fonts[size]

    S = lambda v: round(v * scale)
    for it in items():
        if it[0] == "rect":
            _, x, y, w, h = it
            d.rectangle([S(x), S(y), S(x + w), S(y + h)], outline="black", width=max(1, S(0.6)))
        elif it[0] == "line":
            _, x0, y0, x1, y1 = it
            d.line([S(x0), S(y0), S(x1), S(y1)], fill="black", width=1)
        else:
            _, x, y, size, s, anchor = it
            a = {"center": "ms", "right": "rs", "left": "ls"}[anchor]
            d.text((S(x), S(y)), s, fill="black", font=font(size), anchor=a)
    img.save(path, optimize=True)


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(folder, exist_ok=True)
    write_pdf(os.path.join(folder, "plenary-elevation.pdf"))
    write_png(os.path.join(folder, "plenary-elevation.png"))
    print("wrote", folder)

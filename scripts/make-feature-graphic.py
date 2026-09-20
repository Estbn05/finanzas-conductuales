"""Genera el "Grafico de funciones" (1024x500) para la ficha de Play Store,
usando los colores reales de la app (gradiente oscuro + acento menta) y el icono
existente en assets/icon-512.png. No requiere activos externos.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

W, H = 1024, 500
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "feature-graphic.png")
ICON = os.path.join(os.path.dirname(__file__), "..", "assets", "icon-512.png")

# Colores reales tomados de styles.css (tema oscuro / sidebar)
DEEP_TOP = (21, 35, 31)      # #15231f
DEEP_MID = (11, 44, 38)      # #0b2c26
DEEP_BOTTOM = (6, 31, 27)    # #061f1b
MINT_LIGHT = (126, 232, 196) # #7ee8c4
MINT_DARK = (71, 214, 166)   # #47d6a6
CREAM = (255, 247, 232)      # #fff7e8, color de texto sobre fondo oscuro

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def vertical_gradient(w, h, stops):
    img = Image.new("RGB", (w, h))
    px = img.load()
    n = len(stops) - 1
    for y in range(h):
        t = y / max(h - 1, 1)
        seg = min(int(t * n), n - 1)
        local_t = (t * n) - seg
        color = lerp(stops[seg], stops[seg + 1], local_t)
        for x in range(w):
            px[x, y] = color
    return img

def find_font(paths, size):
    for p in paths:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

bg = vertical_gradient(W, H, [DEEP_TOP, DEEP_MID, DEEP_BOTTOM])

# Resplandor sutil tipo "glow" detras de donde ira el icono, para dar profundidad.
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.ellipse([40, H // 2 - 220, 40 + 440, H // 2 + 220], fill=(71, 214, 166, 60))
glow = glow.filter(ImageFilter.GaussianBlur(70))
bg = Image.alpha_composite(bg.convert("RGBA"), glow)

draw = ImageDraw.Draw(bg)

# Icono de la app, con esquinas redondeadas, a la izquierda.
icon_size = 260
icon = Image.open(ICON).convert("RGBA").resize((icon_size, icon_size), Image.LANCZOS)
mask = Image.new("L", (icon_size, icon_size), 0)
mask_draw = ImageDraw.Draw(mask)
radius = 56
mask_draw.rounded_rectangle([0, 0, icon_size, icon_size], radius=radius, fill=255)
icon_x, icon_y = 70, (H - icon_size) // 2
bg.paste(icon, (icon_x, icon_y), mask)

# Texto: nombre de la app + tagline, a la derecha del icono.
text_x = icon_x + icon_size + 48
title_font = find_font([
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
], 72)
tagline_font = find_font([
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
], 34)

title_line1 = "Finanzas"
title_line2 = "Conductuales"
draw.text((text_x, 118), title_line1, font=title_font, fill=CREAM)
draw.text((text_x, 118 + 82), title_line2, font=title_font, fill=MINT_LIGHT)

tagline = "Entiende tu dinero antes de gastarlo"
draw.text((text_x, 118 + 82 + 100), tagline, font=tagline_font, fill=(220, 230, 226))

bg.convert("RGB").save(OUT, "PNG")
print(f"Guardado: {OUT} ({bg.width}x{bg.height})")

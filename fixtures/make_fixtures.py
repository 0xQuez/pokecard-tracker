"""Synthesize graded fixtures with PHOTOGRAPHIC-texture wear.

Flat white paint reads as glare/overlay to the vision model. Real card wear is
subtle surface abrasion: slightly lightened, desaturated, noisy areas blending
into the artwork. We build a wear mask, add per-pixel noise, and blend with a
lighten/overlay so it looks like scuffed print surface rather than an overlay.
"""
import math
import random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SRC = "fixtures/card_nm.png"
IL, IT, IR, IB = 250, 140, 1798, 1858
IW = IR - IL
IH = IB - IT
RNG = random.Random(7)


def _patch():
    return Image.new("RGBA", (IW, IH), (0, 0, 0, 0))


def _wear_mask(amount, corners, edges):
    """Grayscale mask (0=no wear, 255=fully abraded) for the inner area."""
    m = Image.new("L", (IW, IH), 0)
    d = ImageDraw.Draw(m)
    size = int(IW * (0.16 + 0.14 * amount))
    # Corner wedges.
    for c in corners:
        x, y = [(0, 0), (IW - size, 0), (0, IH - size), (IW - size, IH - size)][c]
        for rr in range(size, 2, -6):
            a = int(120 * amount * (1 - rr / size))
            d.arc([x, y, x + 2 * rr, y + 2 * rr], 0, 90, fill=a, width=6)
            d.ellipse([x, y, x + rr, y + rr], fill=a)
    # Edge strips.
    th = max(3, int(8 + 14 * amount))
    for e in edges:
        if e == 0:
            d.rectangle([0, 0, IW, th], fill=int(110 * amount))
        elif e == 2:
            d.rectangle([0, IH - th, IW, IH], fill=int(110 * amount))
        elif e == 1:
            d.rectangle([IW - th, 0, IW, IH], fill=int(110 * amount))
        else:
            d.rectangle([0, 0, th, IH], fill=int(110 * amount))
    m = m.filter(ImageFilter.GaussianBlur(6))
    return m


def _scratches_mask(n, intensity):
    m = Image.new("L", (IW, IH), 0)
    d = ImageDraw.Draw(m)
    for _ in range(n):
        x = RNG.uniform(0.05, 0.95) * IW
        y = RNG.uniform(0.05, 0.95) * IH
        ln = RNG.uniform(50, 220)
        ang = (RNG.random() - 0.5) * 1.3
        d.line([x, y, x + ln * math.cos(ang), y + ln * math.sin(ang)],
               fill=int(60 + 140 * intensity), width=2)
    return m.filter(ImageFilter.GaussianBlur(1.0))


def _add_noise(alpha, base=150, amp=60):
    noise = Image.effect_noise((IW, IH), amp).convert("L")
    return ImageChops.add(alpha, noise, scale=1.0, offset=0)


def _abrade(img, mask, lighten=255, desat=0.5):
    """Lighten+desaturate the image where the mask is strong (surface scuff)."""
    img = img.convert("RGB")
    hsv = img.convert("HSV")
    h, s, v = hsv.split()
    # Lighten V toward `lighten` proportional to mask.
    v2 = ImageChops.screen(v, mask.point(lambda x: int(x * desat)))
    # Reduce saturation toward 0 where worn.
    s2 = s.point(lambda x: int(x * (1 - 0.5)))
    img2 = Image.merge("HSV", (h, s2, v2)).convert("RGB")
    return img2


def _blend(img, patch, mask):
    """Apply a wear patch + noise to the inner area per the mask."""
    region = img.crop((IL, IT, IR, IB)).convert("RGBA")
    # Build abraded surface.
    abraded = _abrade(region, mask)
    noise = _add_noise(mask)
    abraded = ImageChops.overlay(abraded.convert("L"), noise).convert("RGB")
    # Merge patch overlays (crease/stain drawn separately) via alpha.
    region_rgb = region.convert("RGB")
    abraded_rgb = ImageChops.screen(region_rgb, abraded)
    # Composite original where mask is 0, abraded where strong.
    final = Image.composite(abraded_rgb, region_rgb, mask)
    out = final.convert("RGBA")
    out.alpha_composite(patch)
    img.paste(out, (IL, IT))
    return img


def _crease():
    p = _patch()
    d = ImageDraw.Draw(p)
    d.line([IW*0.05, IH*0.10, IW*0.95, IH*0.92], fill=(120, 112, 96, 220), width=6)
    d.line([IW*0.05, IH*0.10, IW*0.95, IH*0.92], fill=(70, 64, 54, 160), width=2)
    return p


def _stain():
    p = _patch()
    d = ImageDraw.Draw(p)
    cx, cy = int(IW*0.72), int(IH*0.28)
    d.ellipse([cx-85, cy-60, cx+85, cy+60], fill=(100, 66, 38, 170))
    d.ellipse([cx-42, cy-30, cx+42, cy+30], fill=(80, 52, 30, 200))
    return p


def build():
    base = Image.open(SRC).convert("RGBA")

    lp = _blend(base.copy(), _patch(), _wear_mask(0.45, corners=(0,), edges=(0,)))
    lp.save("fixtures/card_lp.png")

    mp = _blend(base.copy(), _patch(),
                ImageChops.add(_wear_mask(0.6, (0, 3), (0, 2)),
                               _scratches_mask(6, 0.4)))
    mp.save("fixtures/card_mp.png")

    hp = _blend(base.copy(), _patch(),
                ImageChops.add(_wear_mask(0.9, (0, 1, 2, 3), (0, 1, 2, 3)),
                               _scratches_mask(18, 0.7)))
    hp.save("fixtures/card_hp.png")

    dmg = _blend(base.copy(), _crease(),
                 ImageChops.add(_wear_mask(0.9, (0, 1, 2, 3), (0, 1, 2, 3)),
                                _scratches_mask(14, 0.6)))
    dmg = _blend(dmg, _stain(),
                 _wear_mask(0.9, (0, 1, 2, 3), (0, 1, 2, 3)))
    dmg.save("fixtures/card_dmg.png")

    print("wrote lp/mp/hp/dmg fixtures")


if __name__ == "__main__":
    build()

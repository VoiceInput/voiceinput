#!/usr/bin/env python3
"""Split the 3D VoiceInput logo render into animatable layers.

PURPOSE
-------
`public/brand/voiceinput-3d.png` is a flat 1024x1024 RGBA render: a glossy glass
plate carrying one dark vertical "caret" pill on the left and five blue glossy
pills (the waveform), plus a soft blue glow cast onto the plate. There is no
layered source file.

To animate the waveform in CSS (a gentle scaleY pulse per bar) the render has to
be torn apart into:

  * a *plate* with every bar and its glow painted out, and
  * one RGBA cut-out per bar, cropped to its bounding box, carrying its own glow
    in a feathered alpha channel.

This script does that tear-down and writes `layers.json` with each bar's position
as a percentage of the canvas, so a page can absolutely position the cut-outs
over the plate with `left/top/width/height` in `%` at any render size.

HOW TO RUN
----------
From the repository root:

    python3 apps/website/scripts/brand-layers.py

It is idempotent: it only reads `voiceinput-3d.png` and overwrites its own
outputs in `apps/website/public/brand/layers/`. Running it twice produces
byte-identical results.

**The outputs are committed to the repo, so nobody needs to rerun this.** It
exists only so the layering can be reproduced or tweaked if the source render
ever changes.

REQUIREMENTS
------------
python3 with numpy, opencv-python (cv2) and Pillow. All three are already
installed in the system python3 on the maintainer's machine (numpy 2.4,
cv2 4.13, Pillow 12). Install elsewhere with:

    python3 -m pip install numpy opencv-python Pillow

HOW IT WORKS
------------
1. Masks are restricted to the plate interior (rows 240-790, cols 200-870) so
   the plate's light blue-grey outer rim is never mistaken for a bar.
2. Core mask: `blue = (B - R > 90) & (B > 140)` for the waveform pills,
   `dark = (R + G + B < 360)` for the caret.
3. Plate: the core mask is dilated by ~41px to swallow the glow halo, each
   masked horizontal run is filled by linear interpolation between its nearest
   unmasked neighbours, and that seed is then relaxed towards a harmonic
   (Laplace) solution by repeated blur-and-restore passes, which erases the
   row-to-row banding and the horizontal seams the per-row ramps leave behind.
   (cv2.inpaint was tried and rejected: it smears the glow into blobs.)
4. Bars: connected components of the core mask dilated by ~9px (small enough to
   keep the five pills separate; a 31px dilation merges them). Each component's
   alpha is a feathered mask multiplied by how far the original pixel departs
   from the reconstructed plate, forced opaque inside the core.
5. Verification: plate + bars are recomposited and diffed against the original.
"""

from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

# --- paths -----------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
WEBSITE = os.path.dirname(HERE)
SRC = os.path.join(WEBSITE, "public", "brand", "voiceinput-3d.png")
OUT_DIR = os.path.join(WEBSITE, "public", "brand", "layers")

# Where the human-eyeball check sheet goes. Deliberately *outside* the repo.
CHECK_SHEET = os.environ.get(
    "BRAND_LAYERS_CHECK",
    "/private/tmp/claude-501/-Users-hirad-Work-voiceinput/"
    "229fbb09-b08c-4dbf-a246-530986c724f7/scratchpad/layers-check.png",
)

# --- tunables (see HOW IT WORKS) -------------------------------------------

INTERIOR = (240, 790, 200, 870)  # row0, row1, col0, col1 — never touch the rim
BLUE_BD = 90       # B - R threshold for the glossy blue pills
BLUE_B = 140       # minimum B for the glossy blue pills
DARK_SUM = 360     # R + G + B ceiling for the dark caret pill
HALO_K = 41        # dilation (px) that covers a bar's glow spill on the plate
RELAX_SIGMA = 2.0  # blur radius of one harmonic relaxation pass
RELAX_ITERS = 400  # relaxation passes; enough for the widest run to go smooth
COMP_K = 9         # dilation used to group a bar into one component
FEATHER_K = 31     # dilation of a component before feathering its alpha
FEATHER_SIGMA = 5.0
ALPHA_SCALE = 60.0  # |orig - plate| that counts as fully opaque
ALPHA_BOOST = 1.15  # nudge the feathered edges up so the glow survives
MIN_AREA = 2000     # anything smaller than this is noise, not a bar
BAR_PAD = 4         # px of padding around each bar's bbox
EXPECTED_BARS = 6   # 1 dark caret + 5 blue waveform pills
WEBP_QUALITY = 95   # >= 92 as required; lossless is also tried, smaller wins


def interior_mask(shape: tuple[int, int]) -> np.ndarray:
    r0, r1, c0, c1 = INTERIOR
    m = np.zeros(shape, dtype=bool)
    m[r0:r1, c0:c1] = True
    return m


def ellipse(k: int) -> np.ndarray:
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))


def build_plate(rgb: np.ndarray, halo: np.ndarray) -> np.ndarray:
    """Paint the halo region out of `rgb` by per-row linear interpolation.

    Every masked horizontal run is replaced by a straight ramp between the
    nearest unmasked pixel on each side, which preserves the plate's smooth
    left-to-right gradient far better than inpainting does. Per-row ramps do
    not agree with each other vertically though, so the seed is then relaxed
    towards a harmonic fill: blur the whole image, keep the blurred values only
    inside the halo, repeat. Pixels outside the halo never move, so the fill
    stays pinned to the real plate at the halo boundary while its interior goes
    perfectly smooth.
    """
    h, w = halo.shape
    filled = rgb.astype(np.float64).copy()

    for y in range(h):
        row = halo[y]
        if not row.any():
            continue
        # Run boundaries via edge detection on the 0/1 row.
        padded = np.concatenate(([0], row.astype(np.int8), [0]))
        edges = np.flatnonzero(np.diff(padded))
        starts, ends = edges[0::2], edges[1::2]
        for s, e in zip(starts, ends):
            left, right = s - 1, e  # first unmasked pixel on each side
            if left < 0 and right >= w:
                continue  # entire row masked: nothing to interpolate from
            lv = filled[y, right] if left < 0 else filled[y, left]
            rv = filled[y, left] if right >= w else filled[y, right]
            n = e - s
            t = np.linspace(0.0, 1.0, n + 2)[1:-1].reshape(-1, 1)
            filled[y, s:e] = lv * (1.0 - t) + rv * t

    # Harmonic relaxation, restricted to a padded bbox around the halo so the
    # 400 blur passes only touch the part of the canvas that can change.
    ys, xs = np.nonzero(halo)
    pad = int(RELAX_SIGMA * 6)
    y0, y1 = max(int(ys.min()) - pad, 0), min(int(ys.max()) + 1 + pad, h)
    x0, x1 = max(int(xs.min()) - pad, 0), min(int(xs.max()) + 1 + pad, w)
    roi = filled[y0:y1, x0:x1]
    roi_mask = halo[y0:y1, x0:x1]
    for _ in range(RELAX_ITERS):
        smooth = cv2.GaussianBlur(roi, (0, 0), RELAX_SIGMA)
        roi[roi_mask] = smooth[roi_mask]
    filled[y0:y1, x0:x1] = roi
    return np.clip(filled, 0.0, 255.0)


def save_webp_or_png(img: Image.Image, base: str) -> tuple[str, int]:
    """Write `base`.webp lossy(q95) and lossless, keep the smaller. Returns
    (filename, size)."""
    lossy = base + ".webp"
    tmp = base + ".lossless.webp"
    img.save(lossy, "WEBP", quality=WEBP_QUALITY, method=6)
    img.save(tmp, "WEBP", lossless=True, method=6)
    if os.path.getsize(tmp) < os.path.getsize(lossy):
        os.replace(tmp, lossy)
    else:
        os.remove(tmp)
    return os.path.basename(lossy), os.path.getsize(lossy)


def pct(v: float, canvas: int) -> float:
    return round(v * 100.0 / canvas, 3)


def main() -> int:
    src = np.array(Image.open(SRC).convert("RGBA"))
    if src.shape[0] != src.shape[1]:
        raise SystemExit(f"expected a square canvas, got {src.shape[:2]}")
    canvas = src.shape[0]
    rgb = src[..., :3].astype(np.int32)
    alpha = src[..., 3]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    region = interior_mask(src.shape[:2])
    blue = ((b - r) > BLUE_BD) & (b > BLUE_B) & region
    dark = ((r + g + b) < DARK_SUM) & region & (alpha > 0)
    core = blue | dark

    os.makedirs(OUT_DIR, exist_ok=True)

    # --- plate ------------------------------------------------------------
    halo = cv2.dilate(core.astype(np.uint8), ellipse(HALO_K)).astype(bool)
    plate_rgb = build_plate(src[..., :3], halo)
    plate_u8 = plate_rgb.round().astype(np.uint8)
    plate_img = Image.fromarray(np.dstack([plate_u8, alpha]), "RGBA")

    plate_files = {}
    name, size = save_webp_or_png(plate_img, os.path.join(OUT_DIR, "plate-1024"))
    plate_files["1024"] = name
    half = plate_img.resize((canvas // 2, canvas // 2), Image.LANCZOS)
    name512, _ = save_webp_or_png(half, os.path.join(OUT_DIR, "plate-512"))
    plate_files["512"] = name512

    # --- bars -------------------------------------------------------------
    grouped = cv2.dilate(core.astype(np.uint8), ellipse(COMP_K))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(grouped, 8)
    comps = [i for i in range(1, count) if stats[i, cv2.CC_STAT_AREA] >= MIN_AREA]
    if len(comps) != EXPECTED_BARS:
        raise SystemExit(
            f"expected {EXPECTED_BARS} bars (1 dark + 5 blue), found {len(comps)}: "
            f"{[tuple(stats[i]) for i in comps]}"
        )
    comps.sort(key=lambda i: stats[i, cv2.CC_STAT_LEFT])

    # Per-pixel opacity driven by how far the original departs from the plate.
    departure = np.abs(src[..., :3].astype(np.float64) - plate_rgb).max(axis=2)
    departure = np.clip(departure / ALPHA_SCALE, 0.0, 1.0)

    bars = []
    for idx, comp in enumerate(comps):
        comp_mask = (labels == comp)
        comp_core = comp_mask & core
        kind = "dark" if (comp_core & dark).sum() > (comp_core & blue).sum() else "blue"

        feather = cv2.dilate(comp_mask.astype(np.uint8), ellipse(FEATHER_K)).astype(np.float64)
        feather = cv2.GaussianBlur(feather, (0, 0), FEATHER_SIGMA)
        a = np.clip(feather, 0.0, 1.0) * departure * ALPHA_BOOST
        a[comp_core] = 1.0
        a = np.clip(a, 0.0, 1.0) * (alpha.astype(np.float64) / 255.0)

        ys, xs = np.nonzero(a > (1.0 / 255.0))
        y0 = max(int(ys.min()) - BAR_PAD, 0)
        y1 = min(int(ys.max()) + 1 + BAR_PAD, canvas)
        x0 = max(int(xs.min()) - BAR_PAD, 0)
        x1 = min(int(xs.max()) + 1 + BAR_PAD, canvas)

        crop = np.dstack([
            src[y0:y1, x0:x1, :3],
            (a[y0:y1, x0:x1] * 255.0).round().astype(np.uint8),
        ])
        bar_img = Image.fromarray(crop, "RGBA")

        png_path = os.path.join(OUT_DIR, f"bar-{idx}.png")
        webp_path = os.path.join(OUT_DIR, f"bar-{idx}.webp")
        bar_img.save(png_path, "PNG", optimize=True)
        bar_img.save(webp_path, "WEBP", lossless=True, method=6)
        png_size, webp_size = os.path.getsize(png_path), os.path.getsize(webp_path)
        if webp_size < png_size:
            chosen, chosen_size, fmt = os.path.basename(webp_path), webp_size, "webp"
            os.remove(png_path)
        else:
            chosen, chosen_size, fmt = os.path.basename(png_path), png_size, "png"
            os.remove(webp_path)

        bars.append({
            "file": chosen,
            "format": fmt,
            "kind": kind,
            "x": pct(x0, canvas),
            "y": pct(y0, canvas),
            "width": pct(x1 - x0, canvas),
            "height": pct(y1 - y0, canvas),
            "px": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
            "bytes": chosen_size,
            "_alpha": a,  # stripped before serialising; used by the recomposite
            "_box": (y0, y1, x0, x1),
        })

    kinds = [bar["kind"] for bar in bars]
    if kinds.count("dark") != 1 or kinds.count("blue") != 5 or kinds[0] != "dark":
        raise SystemExit(f"unexpected bar kinds left-to-right: {kinds}")

    # --- verification -----------------------------------------------------
    recomp = plate_rgb.copy()
    for bar in bars:
        y0, y1, x0, x1 = bar["_box"]
        a = bar["_alpha"][y0:y1, x0:x1, None]
        # Quantise alpha the way the saved file does, so the check reflects the
        # bytes on disk rather than the float intermediates.
        a = (a * 255.0).round() / 255.0
        recomp[y0:y1, x0:x1] = (
            recomp[y0:y1, x0:x1] * (1.0 - a) + src[y0:y1, x0:x1, :3] * a
        )
    recomp_u8 = np.clip(recomp, 0, 255).round().astype(np.uint8)
    diff = np.abs(recomp_u8.astype(np.int32) - src[..., :3].astype(np.int32))
    max_diff = int(diff.max())
    over_12 = int((diff.max(axis=2) > 12).sum())

    os.makedirs(os.path.dirname(CHECK_SHEET), exist_ok=True)
    sheet = np.concatenate([
        src[..., :3],
        plate_u8,
        recomp_u8,
        np.clip(diff * 8, 0, 255).astype(np.uint8),
    ], axis=1)
    Image.fromarray(sheet, "RGB").save(CHECK_SHEET, "PNG")
    Image.fromarray(np.dstack([recomp_u8, alpha]), "RGBA").save(
        os.path.join(os.path.dirname(CHECK_SHEET), "layers-recomposite.png"), "PNG"
    )

    # --- layers.json ------------------------------------------------------
    for bar in bars:
        del bar["_alpha"], bar["_box"]
    manifest = {
        "canvas": canvas,
        "source": "brand/voiceinput-3d.png",
        "generator": "apps/website/scripts/brand-layers.py",
        "plate": {
            "file": plate_files["1024"],
            "file512": plate_files["512"],
            "width": 100.0,
            "height": 100.0,
        },
        "bars": bars,
    }
    with open(os.path.join(OUT_DIR, "layers.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    print(f"bars: {len(bars)} ({kinds.count('dark')} dark, {kinds.count('blue')} blue)")
    for bar in bars:
        print(
            f"  {bar['file']:<12} {bar['kind']:<5} "
            f"left={bar['x']:7.3f}% top={bar['y']:7.3f}% "
            f"w={bar['width']:6.3f}% h={bar['height']:6.3f}%  {bar['bytes']:>6} B"
        )
    print(f"recomposite max per-pixel diff: {max_diff}/255")
    print(f"recomposite pixels differing by > 12: {over_12}")
    print(f"check sheet: {CHECK_SHEET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

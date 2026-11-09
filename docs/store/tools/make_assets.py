"""
Build App Store / Google Play images from raw app screenshots.

  python3 docs/store/tools/make_assets.py <raw-screenshots-dir> docs/store/screenshots

Raw shots are 1290x2796 PNGs named like ar-2-home.png / en-2-home.png (taken from the app at
430x932 points @3x). Output: iOS 6.9" (1290x2796), Android phone (1080x1920) and the Play
feature graphic (1024x500). Needs Pillow with libraqm (Arabic shaping).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont, features

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
FONT = os.path.join(ROOT, 'apps/admin/src/fonts/ReadexPro_700Bold.ttf')
FONT_REG = os.path.join(ROOT, 'apps/admin/src/fonts/ReadexPro_400Regular.ttf')
INK, CREAM, FLAME, STONE = (37, 36, 34), (255, 252, 242), (235, 94, 40), (204, 197, 185)

CAPTIONS = {
    '1-welcome': ('جمعيتك الرقمية، منظّمة لك', 'Your digital jamiya, organised for you'),
    '2-home': ('كل شيء واضح: ما تدفعه وما تستلمه ومتى', 'Clear from day one: what you pay, get and when'),
    '3-join': ('اعرف كم تدفع وكم تستلم قبل أن تنضم', 'See what you pay and receive before joining'),
    '4-circle': ('دورك وجدولك واضحان من أول يوم', 'Your spot and schedule, clear from day one'),
    '5-auction': ('زايد على دور مبكر بشفافية', 'Bid for an early spot, openly'),
    '6-payments': ('إيصال PDF لكل دفعة', 'A PDF receipt for every payment'),
    '7-profile': ('حسابك محمي بـ Face ID', 'Your account protected by Face ID'),
}


def font(size, bold=True):
    return ImageFont.truetype(FONT if bold else FONT_REG, size, layout_engine=ImageFont.Layout.RAQM)


def rounded(im, radius):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], radius, fill=255)
    out = Image.new('RGBA', im.size)
    out.paste(im, (0, 0), mask)
    return out


def caption_lines(text, fnt, max_w, draw, direction):
    words, lines, cur = text.split(), [], ''
    for w in words:
        trial = f'{cur} {w}'.strip()
        if draw.textlength(trial, font=fnt, direction=direction) <= max_w:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return lines


def frame(raw_path, caption, lang, size):
    W, H = size
    canvas = Image.new('RGB', size, INK)
    d = ImageDraw.Draw(canvas)
    direction = 'rtl' if lang == 'ar' else 'ltr'
    fs = int(W * 0.075)
    fnt = font(fs)
    lines = caption_lines(caption, fnt, W * 0.86, d, direction)
    y = int(H * 0.06)
    for line in lines:
        w = d.textlength(line, font=fnt, direction=direction)
        d.text(((W - w) / 2, y), line, font=fnt, fill=CREAM, direction=direction, language=lang)
        y += int(fs * 1.35)
    d.rounded_rectangle([W / 2 - W * 0.06, y + fs * 0.2, W / 2 + W * 0.06, y + fs * 0.32], 6, fill=FLAME)
    top = int(y + fs * 0.9)
    shot = Image.open(raw_path).convert('RGB')
    avail_h = H - top - int(H * 0.04)
    scale = min(W * 0.82 / shot.width, avail_h / shot.height)
    shot = shot.resize((int(shot.width * scale), int(shot.height * scale)), Image.LANCZOS)
    shot = rounded(shot, int(W * 0.05))
    border = Image.new('RGBA', (shot.width + 16, shot.height + 16), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle([0, 0, border.width - 1, border.height - 1], int(W * 0.055), fill=STONE)
    x = (W - border.width) // 2
    canvas.paste(border, (x, top), border)
    canvas.paste(shot, (x + 8, top + 8), shot)
    return canvas


def feature_graphic(out):
    W, H = 1024, 500
    im = Image.new('RGB', (W, H), INK)
    d = ImageDraw.Draw(im)
    # keystone arch mark
    cx, cy, r1, r2 = 820, 250, 120, 70
    import math
    for i in range(7):
        a0, a1 = math.pi * (1 - i / 7) - 0.02, math.pi * (1 - (i + 1) / 7) + 0.02
        pts = []
        for a in [a0 + (a1 - a0) * t / 12 for t in range(13)]:
            pts.append((cx + r1 * math.cos(a), cy - r1 * math.sin(a)))
        for a in [a1 + (a0 - a1) * t / 12 for t in range(13)]:
            pts.append((cx + r2 * math.cos(a), cy - r2 * math.sin(a)))
        d.polygon(pts, fill=FLAME if i == 3 else CREAM)
    d.rounded_rectangle([cx - r1, cy + 6, cx - r2, cy + 80], 6, fill=CREAM)
    d.rounded_rectangle([cx + r2, cy + 6, cx + r1, cy + 80], 6, fill=CREAM)
    d.text((80, 120), 'سند', font=font(110), fill=CREAM, direction='rtl', language='ar')
    d.text((80, 270), 'جمعيتك الرقمية، منظّمة لك', font=font(38), fill=STONE, direction='rtl', language='ar')
    d.text((80, 330), 'Your digital jamiya, organised for you', font=font(32, bold=False), fill=STONE)
    im.save(out)


def main():
    assert features.check('raqm'), 'Pillow needs libraqm for Arabic text'
    raw, out = sys.argv[1], sys.argv[2]
    for sub in ['ios-6.9', 'android-phone']:
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    for lang in ['ar', 'en']:
        for key, (car, cen) in CAPTIONS.items():
            src = os.path.join(raw, f'{lang}-{key}.png')
            if not os.path.exists(src):
                continue
            cap = car if lang == 'ar' else cen
            frame(src, cap, lang, (1290, 2796)).save(os.path.join(out, 'ios-6.9', f'{lang}-{key}.png'))
            frame(src, cap, lang, (1080, 1920)).save(os.path.join(out, 'android-phone', f'{lang}-{key}.png'))
    feature_graphic(os.path.join(out, 'play-feature-graphic.png'))
    print('done')


if __name__ == '__main__':
    main()

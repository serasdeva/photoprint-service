#!/usr/bin/env python3
"""Собирает локальный сабсет Font Awesome Free для сайта.

Зачем: полный CSS+шрифты с CDN — это ~100 КБ стилей и ~150-290 КБ шрифтов ради
нескольких десятков иконок. Скрипт оставляет только используемые и заранее
отобранные глифы и генерирует компактный CSS.

Использование:
  1. Скачать дистрибутив FA 6.5.2 (css/*.min.css и webfonts/*.woff2), например с cdnjs.
  2. python tools/build-fontawesome.py --src <каталог-с-дистрибутивом>

Результат: public/vendor/fontawesome/{icons.css, webfonts/*.woff2}.

Если добавляете на сайт новую иконку — впишите её в USED_IN_APP (или EXTRAS)
и перезапустите скрипт. Иконки вне сабсета (например, вручную введённые
в админке) отображаться не будут.
"""

import argparse
import re
import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter, load_font, save_font

STYLES = {
    "solid": "fa-solid-900.woff2",
    "regular": "fa-regular-400.woff2",
    "brands": "fa-brands-400.woff2",
}
# Глифы всех трёх семейств и их алиасы есть в all.min.css
CSS_FILES = {
    "solid": "all.min.css",
    "regular": "all.min.css",
    "brands": "all.min.css",
}

# Иконки, реально используемые в views/, public/js и seeds/.
USED_IN_APP = {
    "solid": [
        "align-left", "arrow-left", "arrow-right", "arrow-up",
        "arrow-up-right-from-square", "bell", "bolt", "camera", "camera-retro",
        "chart-pie", "check", "check-circle", "chevron-down", "chevron-left",
        "chevron-right", "circle-check", "circle-exclamation", "circle-question",
        "clock", "copy", "envelope", "file-lines", "file-signature", "gear",
        "heading", "headset", "heart", "house", "inbox", "keyboard",
        "layer-group", "link", "list-check", "location-dot", "magnifying-glass",
        "map-location-dot", "moon", "paper-plane", "pen", "phone", "play",
        "plus", "print", "right-from-bracket", "right-to-bracket",
        "ruble-sign", "shield-halved", "shield-heart", "sliders",
        "spinner", "star", "sun", "video", "xmark",
    ],
    "regular": [
        "address-card", "circle-check", "clock", "copy", "eye", "face-frown",
        "file", "folder-open", "image", "images", "inbox", "trash-can", "user",
    ],
    "brands": ["telegram"],
}

# Запас для поля «Иконка (Font Awesome)» в админке: популярные у этой ниши иконки.
EXTRAS = {
    "solid": [
        "angles-down", "angles-up", "angle-down", "angle-left", "angle-right",
        "angle-up", "arrow-down", "arrows-rotate", "award", "barcode",
        "battery-full", "bolt", "box", "boxes", "briefcase", "building",
        "bus", "calendar", "calendar-check", "calendar-days", "car",
        "chart-line", "chart-simple", "clipboard", "clipboard-check",
        "cloud", "cloud-arrow-down", "cloud-arrow-up", "code", "coins",
        "comment", "comments", "computer-mouse", "credit-card", "crop",
        "database", "desktop", "display", "download", "droplet", "earth-americas",
        "envelope-open", "face-smile", "file-arrow-down", "file-arrow-up",
        "file-image", "file-pdf", "file-zipper", "fire", "font", "gift",
        "globe", "graduation-cap", "heart-crack", "headphones", "hourglass",
        "id-card", "italic", "language", "laptop", "leaf", "list", "list-ul",
        "lock", "magnifying-glass-minus", "magnifying-glass-plus", "medal",
        "message", "microchip", "microphone", "mobile-screen", "money-bill",
        "mug-hot", "paintbrush", "palette", "passport", "pen-nib",
        "pencil", "phone-flip", "phone-volume", "plane", "plus",
        "qrcode", "receipt", "robot", "rotate", "seedling", "server",
        "shield", "shop", "snowflake", "square-check", "stamp", "star-half",
        "store", "table", "table-columns", "tag", "tags", "terminal",
        "thermometer-half", "thumbs-up", "trash", "truck", "umbrella",
        "unlock", "upload", "user-lock", "user-plus", "users", "utensils",
        "volume-high", "wallet", "wand-magic-sparkles", "wifi",
    ],
    "regular": [
        "bell", "calendar", "circle", "circle-info", "clock", "comment",
        "envelope", "face-smile", "file-lines", "file-pdf", "heart",
        "hourglass-half", "moon", "pen-to-square", "square", "star", "sun",
        "thumbs-up", "trash-alt",
    ],
    "brands": [
        "facebook", "github", "instagram", "odnoklassniki", "viber", "vk",
        "whatsapp", "x-twitter", "youtube",
    ],
}

FONT_FAMILY = {
    "solid": "Font Awesome 6 Free",
    "regular": "Font Awesome 6 Free",
    "brands": "Font Awesome 6 Brands",
}
FONT_WEIGHT = {"solid": 900, "regular": 400, "brands": 400}

BASE_CSS = """/*!
 * Font Awesome Free 6.5.2 subset, собрано tools/build-fontawesome.py
 * License: https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1)
 */
.fa,.fa-solid,.fa-regular,.fa-brands{-moz-osx-font-smoothing:grayscale;-webkit-font-smoothing:antialiased;display:inline-block;font-style:normal;font-variant:normal;line-height:1;text-rendering:auto}
.fa,.fa-solid{font-family:"Font Awesome 6 Free";font-weight:900}
.fa-regular{font-family:"Font Awesome 6 Free";font-weight:400}
.fa-brands{font-family:"Font Awesome 6 Brands";font-weight:400}
"""


def parse_css(css_path: Path) -> dict:
    """Имя иконки -> кодовая точка.

    В FA часть правил объединяет алиасы в одном селекторе:
    `.fa-file-alt:before,.fa-file-lines:before{content:"\\f15c"}`. Поэтому имя
    нельзя искать только перед `{` — разбираем правило целиком. Заодно
    обрабатываем оба варианта content: эскейп и литеральный PUA-символ.
    """
    text = css_path.read_text(encoding="utf-8")
    mapping = {}

    for selector, body in re.findall(r"([^{}]+)\{([^{}]*)\}", text):
        content = re.search(r'content:\s*"([^"]*)"', body)
        if not content:
            continue

        raw = content.group(1)
        if raw.startswith("\\"):
            code = raw[1:]
        elif raw:
            code = format(ord(raw[0]), "x")
        else:
            continue

        for name in re.findall(r"\.fa-([a-z0-9-]+):before", selector):
            mapping.setdefault(name, code.lower())

    return mapping


def subset_font(src: Path, dst: Path, codepoints) -> None:
    options = Options()
    options.flavor = "woff2"
    options.desubroutinize = True
    font = load_font(str(src), options)
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    save_font(font, str(dst), options)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", required=True, help="каталог с css/ и webfonts/ дистрибутива FA")
    parser.add_argument("--out", default="public/vendor/fontawesome", help="куда положить результат")
    args = parser.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    (out / "webfonts").mkdir(parents=True, exist_ok=True)

    css_parts = [BASE_CSS]
    for style in ("solid", "regular", "brands"):
        mapping = parse_css(src / "css" / CSS_FILES[style])
        wanted = sorted(set(USED_IN_APP[style]) | set(EXTRAS[style]))

        missing = [name for name in wanted if name not in mapping]
        if missing:
            print(f"Ошибка: в {CSS_FILES[style]} нет иконок: {', '.join(missing)}", file=sys.stderr)
            return 1

        codepoints = [int(mapping[name], 16) for name in wanted]
        subset_font(
            src / "webfonts" / STYLES[style],
            out / "webfonts" / STYLES[style],
            codepoints,
        )

        css_parts.append(f'@font-face{{font-family:"{FONT_FAMILY[style]}";font-style:normal;font-weight:{FONT_WEIGHT[style]};font-display:block;src:url("webfonts/{STYLES[style]}") format("woff2")}}')
        for name in wanted:
            css_parts.append(f'.fa-{name}:before{{content:"\\{mapping[name]}"}}')

    (out / "icons.css").write_text("\n".join(css_parts) + "\n", encoding="utf-8")

    for style in ("solid", "regular", "brands"):
        size_kb = (out / "webfonts" / STYLES[style]).stat().st_size / 1024
        count = len(set(USED_IN_APP[style]) | set(EXTRAS[style]))
        print(f"{STYLES[style]}: {count} иконок, {size_kb:.1f} КБ")
    print(f"CSS: {(out / 'icons.css').stat().st_size / 1024:.1f} КБ -> {out / 'icons.css'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

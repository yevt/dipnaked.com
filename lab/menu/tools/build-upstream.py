"""Draw the swimming d from the menu's terminal glyph. Requires fonttools[woff]."""
from math import atan2, degrees
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ASSETS = Path(__file__).resolve().parents[1] / "assets"
# A long swell, a short steep crest and quieter stretches, in side view.
PROFILE = [(0, .4), (16, -.6), (28, .35), (77, -2.8), (92, 1.8),
           (139, -.45), (159, .7), (193, -4.9), (203, 2.5), (256, -.8),
           (288, 1.35), (334, -2.1), (347, .85), (360, .4)]
PERIOD = PROFILE[-1][0]
CAP = 76
LEVEL = 60
LAP = 18


def number(value):
    return f"{value:.3f}".rstrip("0").rstrip(".") if value else "0"


def surface(x):
    x %= PERIOD
    for (left, a), (right, b) in zip(PROFILE, PROFILE[1:]):
        if x <= right:
            t = (x - left) / (right - left)
            return a + (b - a) * t * t * (3 - 2 * t)


def water_path():
    # With the controls at thirds, x is linear and y is the cubic in surface().
    path = [f"M {-PERIOD} {number(PROFILE[0][1])}"]
    for offset in (-PERIOD, 0, PERIOD):
        for (left, a), (right, b) in zip(PROFILE, PROFILE[1:]):
            third = (right - left) / 3
            path.append(f"C {number(offset + left + third)} {number(a)} "
                        f"{number(offset + right - third)} {number(b)} {offset + right} {number(b)}")
    return " ".join(path)


def letter_path():
    font = TTFont(ASSETS / "BlackSquare-v69-d-thin.woff2")
    glyphs = font.getGlyphSet(location={"FILL": 4})
    pen = SVGPathPen(glyphs, ntos=number)
    glyphs[font.getBestCmap()[ord("d")]].draw(TransformPen(pen, (1, 0, 0, -1, 0, 1000)))
    return pen.getCommands()


def build():
    # In one lap the d travels two periods left and the water three periods right.
    # The upright meets the water halfway from its cap to the top of the bowl.
    phases = [-PERIOD * i / 120 for i in range(121)]
    heave = ";".join("0 " + number(surface(x)) for x in phases)
    hull = .82 * CAP
    roll = [number(degrees(atan2(surface(x) - surface(x - hull), hull))) for x in phases]
    letter = f"translate({number(-.955 * CAP)} {number(-.24 * CAP)}) scale({number(CAP / 1000)})"
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160" role="img" aria-labelledby="title desc">
    <title id="title">Против течения</title>
    <desc id="desc">Тонкая d плывёт влево. Одна неровная линия воды проходит через середину её хвоста и движется вправо.</desc>
    <style>
        .still {{ display: none; }}
        @media (prefers-reduced-motion: reduce) {{
            svg:not(.motion-ok) .moving {{ display: none; }}
            svg:not(.motion-ok) .still {{ display: inline; }}
        }}
    </style>
    <defs>
        <path id="water" d="{water_path()}" fill="none" stroke="#171717" stroke-width="1.3" stroke-linecap="round"/>
        <path id="letter" d="{letter_path()}" transform="{letter}"/>
    </defs>
    <g transform="translate(0 {LEVEL})">
        <g class="still">
            <use href="#water"/>
            <use href="#letter" transform="translate({PERIOD} {number(surface(0))}) rotate({roll[0]})"/>
        </g>
        <g class="moving">
            <g>
                <animateTransform attributeName="transform" type="translate" from="0 0" to="{PERIOD} 0" dur="{LAP / 3:g}s" repeatCount="indefinite"/>
                <use href="#water"/>
            </g>
            <g transform="translate({PERIOD} 0)">
                <g>
                    <animateTransform attributeName="transform" type="translate" from="0 0" to="{-2 * PERIOD} 0" dur="{LAP}s" repeatCount="indefinite"/>
                    <g id="swimmer">
                        <animateTransform attributeName="transform" type="translate" values="{heave}" dur="{LAP / 5:g}s" repeatCount="indefinite"/>
                        <g>
                            <animateTransform attributeName="transform" type="rotate" values="{';'.join(roll)}" dur="{LAP / 5:g}s" repeatCount="indefinite"/>
                            <use href="#letter"/>
                        </g>
                    </g>
                    <use href="#swimmer" x="{2 * PERIOD}"/>
                </g>
            </g>
        </g>
    </g>
</svg>
'''
    (ASSETS / "d-upstream.svg").write_text(svg, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    build()

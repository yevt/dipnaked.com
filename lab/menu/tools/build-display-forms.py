"""Rebuild the menu's small alternate faces from its own Black Square webfont.

Requires fonttools[woff] and uharfbuzz. Normal page loads only use the output.
"""
from collections import defaultdict
from copy import deepcopy
from io import BytesIO
import json
from pathlib import Path

import uharfbuzz as hb
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

MENU = Path(__file__).resolve().parents[1]
ASSETS = MENU / "assets"
SOURCE = ASSETS / "BlackSquare-v69.woff2"
ROUND = {"ROND": 100}


def cycles(font):
    # Shape repetitions to read the authored ss02 order, including families
    # where a digit and a letter start at different positions in one cycle.
    stream = BytesIO()
    font.flavor = None
    font.save(stream)
    shaping_font = hb.Font(hb.Face(stream.getvalue()))
    shaping_font.set_variations(ROUND)
    result = {}
    for codepoint in sorted(font.getBestCmap()):
        run = hb.Buffer()
        run.add_str(chr(codepoint) * 24)
        run.guess_segment_properties()
        hb.shape(shaping_font, run, {"ss02": True})
        names = [font.getGlyphName(g.codepoint) for g in run.glyph_infos]
        length = names.index(names[0], 1)
        assert all(name == names[i % length] for i, name in enumerate(names))
        if length > 1:
            result[codepoint] = tuple(names[:length])
    return result


def write_alphabets(forms):
    families = defaultdict(dict)
    for codepoint, sequence in forms.items():
        # All rotations describe the same family, even across scripts.
        key = min(sequence[i:] + sequence[:i] for i in range(len(sequence)))
        phase = key.index(sequence[0])
        families[key].setdefault(phase, []).append(chr(codepoint))
    rows = []
    for key, phases in families.items():
        row = ["".join(phases.get(i, [])) for i in range(len(key))]
        rows.append("    " + json.dumps(row, ensure_ascii=False))
    data = "// Generated from Black Square ss02 by tools/build-display-forms.py.\n"
    (MENU / "glyph-families.js").write_text(
        data + "export const families = [\n" + ",\n".join(rows) + "\n];\n", encoding="utf-8"
    )


def write_faces(font, forms):
    # Keep the FILL axis available for the display weight of every alternate.
    font = instantiateVariableFont(font, ROUND)
    # A face exposes its chosen drawings directly at their original Unicode
    # positions. DOM text and Canvas2D can both select it by font-family.
    del font["GSUB"]
    for offset in range(1, max(map(len, forms.values()))):
        face = deepcopy(font)
        mapping = {cp: seq[offset] for cp, seq in forms.items() if offset < len(seq)}
        for table in face["cmap"].tables:
            if table.isUnicode():
                table.cmap = dict(mapping)
        sub = subset.Subsetter()
        sub.populate(unicodes=mapping)
        sub.subset(face)
        face.flavor = "woff2"
        face.recalcTimestamp = False
        face.save(ASSETS / f"BlackSquare-v69-form{offset + 1}.woff2")


if __name__ == "__main__":
    source = TTFont(SOURCE, recalcTimestamp=False)
    sequences = cycles(source)
    write_alphabets(sequences)
    write_faces(source, sequences)

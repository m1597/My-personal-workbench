"""Verify the original crop and preserved connectors in the GnuTLS acceptance fixture."""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageChops

folder = Path(sys.argv[1])
original = Image.open(folder / "original.png").convert("RGB")
capture = Image.open(folder / "capture.png").convert("RGB")
assert original.size == capture.size and not ImageChops.difference(original, capture).getbbox()
mask = Image.new("1", original.size)
draw = ImageDraw.Draw(mask)
for x, y, right, bottom in json.loads((folder / "boxes.json").read_text()):
    draw.rectangle((math.floor(x)-2, math.floor(y)-2, math.ceil(right)+2, math.ceil(bottom)+2), fill=1)
for name in ("chinese", "bilingual"):
    allowed=mask.copy()
    if name=="bilingual":
        expanded=ImageDraw.Draw(allowed)
        for x,y,r,b in json.loads((folder/"bilingual-boxes.json").read_text()):
            expanded.rectangle((math.floor(x)-1,math.floor(y)-1,math.ceil(r)+1,math.ceil(b)+1),fill=1)
    output = Image.open(folder / (name + ".png")).convert("RGB")
    assert output.size == original.size
    before, after, labels = original.load(), output.load(), mask.load()
    changed = outside = blue = damaged = 0
    for y in range(output.height):
        for x in range(output.width):
            r, g, b = before[x, y]
            different = before[x, y] != after[x, y]
            is_blue = b > 140 and r < 100 and g < 140
            changed += different
            outside += different and not allowed.getpixel((x,y))
            if not labels[x,y] and min(r,g,b)<180: assert not different, (name,x,y,before[x,y],after[x,y])
            blue += is_blue
            damaged += is_blue and different
    print(f"{name}: changed={changed} outside={outside} blue_connectors={blue} damaged={damaged}")
    assert changed > 1000 and outside == 0 and blue > 100 and damaged == 0

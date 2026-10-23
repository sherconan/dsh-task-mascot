# v2 states: build tiny 2-key animated webp fallback + poster straight from keyed K1/K2 PNGs.
import sys,os
from PIL import Image
SRC=sys.argv[1]; OUT=sys.argv[2]
FAST={'busy','coding_b','cmd_b','editing_b','worried','retry','sweat','download','install'}
for st in sys.argv[3:]:
  k=[Image.open(f'{SRC}/fishv2{st}/{n}.png').convert('RGBA').resize((256,256),Image.LANCZOS) for n in ('K1','K2')]
  d=[267,233] if st in FAST else [767,567]
  k[0].save(f'{OUT}/{st}.webp',save_all=True,append_images=[k[1]],duration=d,loop=0,quality=70,method=6)
  k[0].quantize(256,method=Image.Quantize.FASTOCTREE).save(f'{OUT}/{st}.png',optimize=True)

from pathlib import Path
from PIL import Image

native = Path(__file__).resolve().parent
root = native.parents[1]
out = native / "build" / "icons"
out.mkdir(parents=True, exist_ok=True)
image = Image.open(root / "assets" / "icon-512.png").convert("RGBA")
image.save(out / "OpenPath.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
image.save(out / "OpenPath.icns")

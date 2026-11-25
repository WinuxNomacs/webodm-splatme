"""
split.py <folder with dataset.zip>: unpacks it to full/ (for LichtFeld, which holds out photos itself with --eval
--test-every 8) and makes train/, the same without every 8th photo by name (i % 8 == 0, case-sensitive order: the
photos LichtFeld holds out), for trainers that train on everything they are given. Writes held_out.txt.
Run with python3 -I (the zip is data, not code).
"""
import os
import shutil
import struct
import sys
import zipfile

os.chdir(sys.argv[1])
zipfile.ZipFile("dataset.zip").extractall("full")


def read_images(path):
    """COLMAP images.bin as (name, raw record) pairs."""
    with open(path, "rb") as f:
        b = f.read()
    (n,) = struct.unpack_from("<Q", b, 0)
    o, out = 8, []
    for _ in range(n):
        start = o
        o += 4 + 32 + 24 + 4
        end = b.index(b"\0", o)
        name = b[o:end].decode()
        o = end + 1
        (k,) = struct.unpack_from("<Q", b, o)
        o += 8 + 24 * k
        out.append((name, b[start:o]))
    assert o == len(b)
    return out


sp = "full/sparse/0"
imgs = read_images(f"{sp}/images.bin")
held = set(sorted(n for n, _ in imgs)[0::8])
shutil.copytree("full", "train")
keep = [r for n, r in imgs if n not in held]
with open("train/sparse/0/images.bin", "wb") as f:
    f.write(struct.pack("<Q", len(keep)) + b"".join(keep))
for n in held:
    os.remove(f"train/images/{n}")
    if os.path.exists(f"train/masks/{n}.png"):
        os.remove(f"train/masks/{n}.png")
assert len(read_images("train/sparse/0/images.bin")) == len(os.listdir("train/images")) == len(imgs) - len(held)
with open("held_out.txt", "w") as f:
    f.write("\n".join(sorted(held)) + "\n")
print("images", len(imgs), "held out", len(held), "train", len(imgs) - len(held))

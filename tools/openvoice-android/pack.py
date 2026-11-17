"""Package only the verified self-export; never accepts arbitrary ONNX graphs."""
import argparse
import hashlib
import zipfile
from pathlib import Path
HASHES = {
    'tone_encoder.onnx': '64bd5e39bc92b1265e35eeb73e9e30558de6c54f15c176bff6f9b7543a0a2c91',
    'tone_converter.onnx': '19ced6f4232d212e21ebd8562bd10eae7b5731610587dcdb691c1cedcf2f7507',
}
p = argparse.ArgumentParser()
p.add_argument('models', type=Path)
p.add_argument('output', type=Path)
a = p.parse_args()
for name, digest in HASHES.items():
    actual = hashlib.sha256((a.models / name).read_bytes()).hexdigest()
    if actual != digest:
        raise SystemExit(f'Unverified graph {name}: {actual}; do not bypass native validation')
files = {name: a.models / name for name in HASHES}
files.update({name: Path(__file__).parent / name for name in ['OPENVOICE-LICENSE.txt', 'MODEL-NOTICE.txt']})
with zipfile.ZipFile(a.output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=3) as z:
    for name, path in sorted(files.items()):
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        z.writestr(info, path.read_bytes(), compresslevel=3)
print(f'{a.output.stat().st_size} bytes; importing does not enable local mode')

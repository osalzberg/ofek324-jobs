"""Package a completed standalone build without source or environment files."""
from pathlib import Path
import sys
import zipfile

web = Path(__file__).resolve().parents[1] / "web"
standalone = web / ".next" / "standalone"
if not (standalone / "server.js").is_file():
    raise SystemExit("Build web/ with its configured tracing root before packaging.")
target = Path(sys.argv[1]).resolve()
target.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for source, prefix in [(standalone, ""), (web / ".next" / "static", ".next/static"), (web / "public", "public")]:
        for path in sorted(source.rglob("*")):
            if not path.is_file() or path.name.startswith(".env") or path.suffix in (".log", ".tsbuildinfo"):
                continue
            relative = path.relative_to(source)
            archive.write(path, str(Path(prefix) / relative))
print(f"Packaged standalone app: {target.name} ({target.stat().st_size / 1024 / 1024:.1f} MiB)")

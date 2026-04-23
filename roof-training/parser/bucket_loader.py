"""Download all EagleView vendor diagram PDFs that have a `diagram_image_url`.

Reads `roof_vendor_reports` via the Supabase REST API (anon key + signed URLs
in the row, no service role needed because the URLs are pre-signed).

Usage:
    python bucket_loader.py --out /tmp/ev_pdfs --limit 0
"""
from __future__ import annotations
import argparse, json, os, sys, pathlib, urllib.request, urllib.error

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://alxelfrbjzkmtnsulcei.supabase.co")
ANON_KEY = os.environ.get(
    "SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM",
)


def list_eagleview_with_diagrams() -> list[dict]:
    url = (
        f"{SUPABASE_URL}/rest/v1/roof_vendor_reports"
        "?select=id,address,provider,diagram_image_url"
        "&provider=eq.eagleview&diagram_image_url=not.is.null"
        "&order=created_at.desc"
    )
    req = urllib.request.Request(
        url,
        headers={"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def download_one(row: dict, out_dir: pathlib.Path) -> pathlib.Path | None:
    rid = row["id"]
    url = row["diagram_image_url"]
    target = out_dir / f"{rid}.pdf"
    if target.exists() and target.stat().st_size > 50_000:
        return target
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            body = r.read()
    except urllib.error.URLError as e:
        print(f"  ! {rid}: {e}", file=sys.stderr)
        return None
    if len(body) < 1000 or not body.startswith(b"%PDF"):
        print(f"  ! {rid}: not a PDF ({len(body)}B)", file=sys.stderr)
        return None
    target.write_bytes(body)
    return target


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/ev_pdfs")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = list_eagleview_with_diagrams()
    if args.limit:
        rows = rows[: args.limit]
    print(f"Found {len(rows)} EagleView reports with diagrams.")

    manifest = []
    for i, row in enumerate(rows, 1):
        print(f"[{i}/{len(rows)}] {row['id']}  {row.get('address','')}")
        path = download_one(row, out)
        if path:
            manifest.append({**row, "local_pdf": str(path)})
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Saved {len(manifest)} PDFs to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

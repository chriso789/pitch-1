"""Run the full Phase-3 validation across every cached EagleView PDF.

For each PDF:
  1. find LENGTH DIAGRAM page → render at 300 DPI
  2. extract Report Summary truth (ridges/hips/valleys/rakes/eaves ft)
  3. parse the diagram → per-class pixels → calibrated feet
  4. compute combined-channel error % (red/blue/black)
  5. record pass/fail vs ±3% acceptance bar

Writes:
  /tmp/ev_parse_out/<id>.length.png
  /tmp/ev_parse_out/<id>.json
  /tmp/ev_parse_out/_report.json    (summary)
"""
from __future__ import annotations
import json, pathlib, sys, traceback

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from extract_length_page import extract as extract_length
from extract_summary_truth import extract_truth
from parse_diagram import parse


def main(pdf_dir: str = "/tmp/ev_pdfs", out_dir: str = "/tmp/ev_parse_out") -> int:
    src = pathlib.Path(pdf_dir)
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    pdfs = sorted(src.glob("*.pdf"))
    print(f"Validating {len(pdfs)} PDFs…")

    results = []
    no_length, no_truth, errors = 0, 0, 0

    for i, pdf in enumerate(pdfs, 1):
        rid = pdf.stem
        rec: dict = {"id": rid}
        try:
            png = out / f"{rid}.length.png"
            page_idx = extract_length(pdf, png)
            if page_idx is None:
                rec["error"] = "no LENGTH DIAGRAM page"
                no_length += 1
                results.append(rec)
                continue
            rec["page_index"] = page_idx

            truth = extract_truth(pdf)
            if not truth:
                rec["error"] = "no Report Summary truth"
                no_truth += 1
                results.append(rec)
                continue
            rec["truth_ft"] = truth

            parsed = parse(png, truth)
            rec.update(parsed)
            (out / f"{rid}.json").write_text(json.dumps(parsed, indent=2))
        except Exception as e:
            rec["error"] = f"{type(e).__name__}: {e}"
            rec["traceback"] = traceback.format_exc(limit=3)
            errors += 1
        results.append(rec)
        ok = rec.get("passes_strict_3pct")
        tag = "✓" if ok else ("·" if "error" not in rec else "x")
        print(f"  [{i:>2}/{len(pdfs)}] {tag} {rid}  err={rec.get('error','')}")

    # Aggregate
    parsed_ok = [r for r in results if "combined_err_pct" in r]
    classes = ["ridges_plus_hips", "valleys", "rakes_plus_eaves"]
    per_class_pass = {c: 0 for c in classes}
    per_class_err  = {c: [] for c in classes}
    strict_pass = 0
    for r in parsed_ok:
        if r.get("passes_strict_3pct"):
            strict_pass += 1
        for c in classes:
            e = r["combined_err_pct"].get(c)
            if e is None:
                continue
            per_class_err[c].append(e)
            if e <= 3.0:
                per_class_pass[c] += 1

    def stats(lst):
        if not lst:
            return {"n": 0}
        a = sorted(lst)
        return {
            "n": len(a),
            "mean_pct": round(sum(a) / len(a), 2),
            "median_pct": round(a[len(a) // 2], 2),
            "p90_pct": round(a[int(len(a) * 0.9) - 1], 2) if len(a) >= 10 else None,
            "max_pct": round(a[-1], 2),
        }

    summary = {
        "total_pdfs": len(pdfs),
        "no_length_page": no_length,
        "no_truth": no_truth,
        "exceptions": errors,
        "parsed_with_truth": len(parsed_ok),
        "strict_3pct_pass": strict_pass,
        "strict_3pct_pass_rate": (strict_pass / len(parsed_ok)) if parsed_ok else 0,
        "per_class": {
            c: {
                **stats(per_class_err[c]),
                "pass_3pct": per_class_pass[c],
                "pass_rate": (per_class_pass[c] / len(parsed_ok)) if parsed_ok else 0,
            }
            for c in classes
        },
    }
    (out / "_report.json").write_text(json.dumps(
        {"summary": summary, "results": results}, indent=2))

    print("\n=== PHASE 3 SUMMARY ===")
    print(json.dumps(summary, indent=2))
    print(f"\nFull report: {out / '_report.json'}")
    bar = summary["strict_3pct_pass_rate"]
    print(f"Acceptance bar (≥90% strict ±3%): {'PASS' if bar >= 0.90 else 'FAIL'} ({bar*100:.1f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

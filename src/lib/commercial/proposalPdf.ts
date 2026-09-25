import jsPDF from "jspdf";
import { money } from "@/lib/commercial/engine";

/** Builds a clean bid proposal PDF from a locked estimate version snapshot. */
export function buildProposalPdf(opts: { project: any; version: any; company?: { name?: string; phone?: string; email?: string; address?: string } }) {
  const { project, version, company } = opts;
  const snap = version.snapshot || {};
  const est = snap.estimate || {};
  const lines: any[] = snap.lines || [];
  const t = snap.totals || {};
  const sys = project.metadata?.plan_analysis?.roof_system || {};
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 48;
  let y = M;
  const ensure = (h: number) => { if (y + h > 740) { doc.addPage(); y = M; } };
  const text = (s: string, size = 10, bold = false, x = M) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); const parts = doc.splitTextToSize(s, W - M - x); ensure(parts.length * size * 1.3); doc.text(parts, x, y); y += parts.length * size * 1.3; };

  doc.setFillColor(30, 41, 59); doc.rect(0, 0, W, 70, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text(company?.name || "Roofing Proposal", M, 42);
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.text([company?.phone, company?.email].filter(Boolean).join("  ·  "), W - M, 42, { align: "right" });
  doc.setTextColor(20, 20, 20); y = 100;

  text("BID PROPOSAL", 14, true);
  text(`${project.name}${project.project_number ? `  ·  #${project.project_number}` : ""}`, 11, true);
  if (project.address) text(project.address, 10);
  text([project.gc_name && `To: ${project.gc_name}`, project.architect_name && `Architect: ${project.architect_name}`, project.bid_due_date && `Bid date: ${project.bid_due_date}`].filter(Boolean).join("   ·   "), 9);
  text(`Version ${version.version_number} · ${new Date(version.created_at).toLocaleDateString()}`, 9);
  y += 10;

  text("Roof system", 12, true);
  const sysLine = [sys.membrane, sys.insulation, sys.cover_board, sys.attachment].filter(Boolean).join(", ");
  text(sysLine || "Per plans and specifications.", 10);
  if (sys.warranty) text(`Warranty: ${sys.warranty}`, 10);
  y += 8;

  text("Scope of work", 12, true);
  const scope = lines.filter((l) => l.kind === "material" || l.kind === "subcontract").map((l) => l.description);
  [...new Set(scope)].slice(0, 30).forEach((s) => text(`•  ${s}`, 10, false, M + 8));
  (project.metadata?.plan_analysis?.scope_notes || []).slice(0, 10).forEach((s: string) => text(`•  ${s}`, 10, false, M + 8));
  y += 8;

  if (est.exclusions) { text("Exclusions & clarifications", 12, true); String(est.exclusions).split(/\n+/).filter(Boolean).forEach((s) => text(`•  ${s}`, 10, false, M + 8)); y += 8; }

  ensure(80);
  doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 22;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text("Base bid", M, y); doc.text(money(t.bid ?? version.bid_total ?? 0), W - M, y, { align: "right" }); y += 18;
  if (project.roof_area_sf) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(`${Number(project.roof_area_sf).toLocaleString()} SF`, W - M, y, { align: "right" }); y += 14; }
  y += 24;

  text("Acceptance", 12, true);
  text("This proposal is valid for 30 days. Signature below authorizes the work described above.", 9);
  y += 30; ensure(40);
  doc.line(M, y, M + 220, y); doc.line(W - M - 160, y, W - M, y); y += 12;
  doc.setFontSize(8); doc.text("Authorized signature", M, y); doc.text("Date", W - M - 160, y);

  return doc;
}

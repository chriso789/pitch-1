import { PDFDocument, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fontAsset from '@/assets/photo-report-unicode.ttf.asset.json';
import { assertReportExportable } from './reportExportGuard';
import { reportEntries, type PhotoIntelligenceReport, type ReportFindingEntry } from './reportModel';
import { validateAnnotation, type Annotation, type Point } from './annotations';

// Print palette: centralized roles, independent of the application's dark theme.
const ink = rgb(0.12, 0.16, 0.2);
const muted = rgb(0.36, 0.4, 0.44);
const accent = rgb(0.05, 0.39, 0.48);
const rule = rgb(0.83, 0.86, 0.88);
const callout = rgb(0.8, 0.12, 0.13);
const paper = rgb(1, 1, 1);
const W = 612, H = 792, M = 42, WIDTH = W - 2 * M;

export interface ReportPdfOptions {
  fontBytes?: Uint8Array;
  /** Must return original evidence bytes, not annotated derivatives. */
  resolveImage: (storagePath: string) => Promise<Uint8Array>;
  resolveLogo?: (url: string) => Promise<Uint8Array>;
}

export async function generatePhotoReportPdf(report: PhotoIntelligenceReport, options: ReportPdfOptions): Promise<Uint8Array> {
  assertReportExportable(report);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontResponse = options.fontBytes ? null : await fetch(fontAsset.url);
  if (fontResponse && !fontResponse.ok) throw new Error('Report font could not be loaded.');
  const fontBytes = options.fontBytes ?? new Uint8Array(await fontResponse?.arrayBuffer());
  const font = await pdf.embedFont(fontBytes, { subset: true });
  pdf.setTitle(report.property.reportTitle ?? 'Property Photo Inspection Report');
  pdf.setAuthor(report.branding.companyName);
  pdf.setSubject(`${report.property.address} | Approved version ${report.version}`);
  let page: PDFPage;
  let y = H - M;
  const newPage = (title: string) => {
    page = pdf.addPage([W, H]);
    const companySize = Math.min(10, 10 * WIDTH / Math.max(WIDTH, font.widthOfTextAtSize(report.branding.companyName, 10)));
    page.drawText(report.branding.companyName, { x: M, y: H - M, size: companySize, font, color: accent });
    const titleSize = Math.min(17, 17 * WIDTH / Math.max(WIDTH, font.widthOfTextAtSize(title, 17)));
    page.drawText(title, { x: M, y: H - M - 30, size: titleSize, font, color: ink });
    page.drawLine({ start: { x: M, y: H - M - 43 }, end: { x: W - M, y: H - M - 43 }, color: rule });
    y = H - M - 65;
  };
  const text = (value: string, size = 10, color = ink) => {
    const lines = wrap(value, font, size, WIDTH);
    for (const line of lines) {
      if (y < 66) newPage('Inspection report — continued');
      page.drawText(line, { x: M, y, size, font, color });
      y -= size * 1.5;
    }
    y -= 6;
  };
  const images = new Map<string, Awaited<ReturnType<PDFDocument['embedJpg']>>>();
  const getImage = async (path: string) => {
    const cached = images.get(path);
    if (cached) return cached;
    let bytes: Uint8Array;
    try { bytes = await options.resolveImage(path); }
    catch { throw new Error('An original evidence photograph could not be loaded; export stopped.'); }
    const image = bytes[0] === 0x89 ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    images.set(path, image);
    return image;
  };
  const photo = async (path: string, annotations: Annotation[] = [], maxHeight = 310) => {
    const image = await getImage(path);
    const scale = Math.min(WIDTH / image.width, maxHeight / image.height);
    const width = image.width * scale, height = image.height * scale;
    if (y - height < 66) newPage('Photo evidence — continued');
    const x = M + (WIDTH - width) / 2, bottom = y - height;
    page.drawImage(image, { x, y: bottom, width, height });
    for (const ann of annotations) drawAnnotation(page, font, ann, x, bottom, width, height);
    y = bottom - 20;
  };
  newPage('Property Photo Inspection Report');
  if (report.branding.logoUrl && options.resolveLogo) {
    const bytes = await options.resolveLogo(report.branding.logoUrl);
    const logo = bytes[0] === 0x89 ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const s = Math.min(180 / logo.width, 65 / logo.height);
    page.drawImage(logo, { x: M, y: y - 65, width: logo.width * s, height: logo.height * s });
    y -= 90;
  }
  text(report.property.reportTitle ?? 'Property condition and photographic evidence', 19);
  text(report.property.address, 15);
  text(`Inspection date: ${report.property.inspectedAt.slice(0, 10)}`);
  text(`Inspector: ${report.property.inspectorName}`);
  text(`Approved version: ${report.version}`);
  text(`Approved by ${report.approval?.approvedBy} on ${report.approval?.approvedAt.slice(0, 10)}`);
  for (const line of [report.branding.phone, report.branding.email, report.branding.licenseLine]) if (line) text(line, 9, muted);
  text('Visible conditions only. This report does not establish concealed damage, causation, age, or insurance eligibility.', 10, muted);
  newPage('Executive summary');
  text(report.executiveSummary);
  text('Priority inventory', 13);
  for (const [severity, count] of Object.entries(report.priorityCounts)) if (count) text(`${severity}: ${count}`);
  text('Potential water-entry concerns', 13);
  if (!report.waterEntryConcerns.length) text('No potential water-entry concerns recorded in the approved findings.');
  for (const entry of report.waterEntryConcerns) text(`${entry.findingRef} — ${entry.buildingLabel}: ${entry.condition}`);
  text('Recommended next steps', 13);
  report.recommendedNextSteps.forEach((s) => text(s));
  text('Inspection limitations', 13);
  if (!report.limitations.length) text('No additional limitations recorded. This is not proof of unrestricted visibility.');
  report.limitations.forEach((s) => text(s));
  newPage('Property overview');
  if (report.siteOverview) {
    await photo(report.siteOverview.storagePath, report.siteOverview.markers.map((m, i) => ({ id: `building-${i}`, kind: 'callout', at: { x: m.x, y: m.y }, label: i + 1, color: '', buildingLabel: m.buildingLabel })), 360);
    text(`Image attribution: ${report.siteOverview.attribution}`, 9, muted);
    report.siteOverview.markers.forEach((m, i) => text(`${i + 1}. ${m.buildingLabel}`));
    text('Building locations are relative to this photograph. Geographic coordinates and roof quantities are not inferred.', 9, muted);
  } else text('Aerial overview not supplied. Building assignments below are inspector-recorded labels, not a measured site map.');
  const entries = reportEntries(report);
  for (const building of report.buildings) {
    newPage(`Building inventory: ${building.buildingLabel}`);
    for (const entry of building.findings) {
      text(`${entry.findingRef} | ${entry.component} | ${entry.severity}`, 12);
      text(`${entry.roofPlane ?? 'Slope/elevation not recorded'} — ${entry.condition}`);
      if (entry.description) text(entry.description);
    }
  }
  if (report.noDamageAreas.length) {
    newPage('Components appearing visually normal');
    report.noDamageAreas.forEach((s) => text(s));
  }
  for (const [title, observations] of [['Maintenance recommendations', report.maintenanceFindings ?? []], ['Areas not adequately assessed', report.unassessedFindings ?? []]] as const) {
    if (!observations.length) continue;
    newPage(title);
    for (const entry of observations) {
      text(`${entry.findingRef} — ${entry.buildingLabel} | ${entry.component}: ${entry.condition.replace(/_/g, ' ')}`);
      if (entry.recommendedVerification) text(entry.recommendedVerification);
    }
  }
  for (const entry of entries) {
    newPage(`Finding ${entry.findingRef} — photographic evidence`);
    text(`${entry.buildingLabel} | ${entry.roofPlane ?? 'Slope not recorded'} | ${entry.component}`, 11);
    text(`${entry.condition}${entry.description ? ` — ${entry.description}` : ''}`);
    text(`Source: ${entry.detectionSource === 'reference_label' ? 'Imported reference annotation — not an independent PITCH AI detection' : entry.detectionSource === 'ai' ? 'AI proposal subsequently reviewed by inspector' : 'Inspector observation'}`, 9, muted);
    if (entry.limitations) text(`Limitations: ${entry.limitations}`);
    if (entry.recommendedVerification) text(`Verification: ${entry.recommendedVerification}`);
    for (const [i, path] of entry.evidencePhotoPaths.entries()) {
      const evidence = entry.evidence?.find((e) => e.storagePath === path);
      await photo(path, evidence?.annotations);
      text(`Photo ${i + 1} | Finding ID: ${entry.findingId}`, 8, muted);
      text(`Evidence ID: ${evidence?.evidenceId ?? 'Legacy evidence'} | Annotation source: ${evidence?.source ?? 'Not recorded'}`, 8, muted);
    }
  }
  const paths = [...new Set(entries.flatMap((e) => e.evidencePhotoPaths))];
  for (const [i, path] of paths.entries()) {
    newPage(`Appendix — original photograph ${i + 1}`);
    await photo(path, [], 440);
    text(`Original evidence reference: ${path}`, 8, muted);
    text(`Linked findings: ${entries.filter((e) => e.evidencePhotoPaths.includes(path)).map((e) => e.findingRef).join(', ')}`, 9);
    text('No PITCH annotations are applied to this appendix image. Any marks already present in the supplied source remain part of that source.', 9, muted);
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 42 }, end: { x: W - M, y: 42 }, color: rule });
    p.drawText(`Version ${report.version} | Page ${i + 1} of ${pages.length}`, { x: M, y: 27, size: 8, font, color: muted });
  });
  const bytes = await pdf.save();
  const reopened = await PDFDocument.load(bytes);
  if (reopened.getPageCount() !== pages.length) throw new Error('PDF page verification failed.');
  return bytes;
}

function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  // Unsupported glyphs block export instead of being replaced or lost.
  const supported = new Set(font.getCharacterSet());
  for (const c of value) if (!/\s/.test(c) && !supported.has(c.codePointAt(0) ?? 0)) throw new Error('The report contains a character unsupported by its embedded font.');
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      line = '';
      for (const c of word) {
        if (font.widthOfTextAtSize(line + c, size) > width) { lines.push(line); line = ''; }
        line += c;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawAnnotation(page: PDFPage, font: PDFFont, a: Annotation, x: number, y: number, w: number, h: number) {
  const points: Point[] = a.kind === 'polygon' ? a.points : a.kind === 'bbox' ? [a.origin, { x: a.origin.x + a.size.x, y: a.origin.y + a.size.y }] : a.kind === 'circle' ? [a.center] : a.kind === 'arrow' ? [a.from, a.to] : [a.at, ...(a.target ? [a.target] : [])];
  if (validateAnnotation(a) || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) throw new Error('Invalid evidence annotation; review its coordinates before export.');
  const at = (p: Point) => ({ x: x + p.x * w, y: y + (1 - p.y) * h });
  const line = (from: Point, to: Point) => page.drawLine({ start: at(from), end: at(to), thickness: 1.8, color: callout });
  if (a.kind === 'polygon') a.points.forEach((p, i) => line(p, a.points[(i + 1) % a.points.length]));
  if (a.kind === 'bbox') page.drawRectangle({ x: x + a.origin.x * w, y: y + (1 - a.origin.y - a.size.y) * h, width: a.size.x * w, height: a.size.y * h, borderColor: callout, borderWidth: 1.8 });
  if (a.kind === 'circle') page.drawCircle({ ...at(a.center), size: a.radius * w, borderColor: callout, borderWidth: 1.8 });
  if (a.kind === 'arrow' || (a.kind === 'callout' && a.target)) {
    const from = a.kind === 'arrow' ? a.from : a.at;
    const to = a.kind === 'arrow' ? a.to : a.target;
    if (to) {
      line(from, to);
      const f = at(from), t = at(to), angle = Math.atan2(t.y - f.y, t.x - f.x);
      for (const d of [-0.5, 0.5]) page.drawLine({ start: t, end: { x: t.x - 9 * Math.cos(angle + d), y: t.y - 9 * Math.sin(angle + d) }, color: callout, thickness: 1.8 });
    }
  }
  if (a.kind === 'callout' || a.label != null) {
    const p = at(points[0]);
    page.drawCircle({ ...p, size: 10, color: callout });
    page.drawText(String(a.label ?? 1), { x: p.x - 3, y: p.y - 3, font, size: 8, color: paper });
  }
}
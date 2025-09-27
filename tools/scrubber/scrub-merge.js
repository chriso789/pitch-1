// tools/scrubber/scrub-merge.js
/* eslint-disable */
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'scrubber.config.json'), 'utf8'));
const OUT_DIR = path.resolve(__dirname, cfg.reportOutDir || './out');

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), 'utf8')); }
  catch { return []; }
}

function isoNow() { return new Date().toISOString(); }

function main() {
  const dyn = readJSON('dynamic-report.json');
  const stat = readJSON('static-report.json');

  // Promote dynamic actionless + broken
  const dynamicAnomalies = dyn.filter(r => ['ACTIONLESS','BROKEN_ENDPOINT','JS_ERROR','NAV_ERROR'].includes(r.classification));

  // Map static issues that are likely "actionless"
  const staticActionless = stat.filter(f => ['NO_HANDLER','ANCHOR_NO_HREF','MISSING_FN','MISSING_API'].includes(f.kind));

  const out = {
    generatedAt: isoNow(),
    totals: {
      dynamicTested: dyn.filter(r=>r.element).length,
      dynamicActionless: dynamicAnomalies.length,
      staticSuspects: staticActionless.length
    },
    dynamicAnomalies,
    staticActionless
  };

  fs.writeFileSync(path.join(OUT_DIR, 'scrub-merged.json'), JSON.stringify(out, null, 2));

  let md = `# Actionless Buttons & Broken Actions — Combined Report\n\nGenerated: ${isoNow()}\n\n`;
  md += `## Totals\n- Dynamic tested clickables: ${out.totals.dynamicTested}\n- Dynamic anomalies: ${out.totals.dynamicActionless}\n- Static suspects: ${out.totals.staticSuspects}\n\n`;
  md += `## Dynamic — Actionless / Broken\n\n| Page | Selector | Label/Href | Class |\n|---|---|---|---|\n`;
  for (const r of dynamicAnomalies) {
    md += `| ${r.pageUrl} | \`${r.element?.selector || ''}\` | ${r.element?.href || r.element?.label || ''} | ${r.classification} |\n`;
  }
  md += `\n## Static — Suspects\n\n| Kind | File | Line | Detail |\n|---|---|---:|---|\n`;
  for (const f of staticActionless) {
    md += `| ${f.kind} | ${f.file} | ${f.line} | ${f.detail} |\n`;
  }
  fs.writeFileSync(path.join(OUT_DIR, 'scrub-merged.md'), md);

  console.log(`Wrote:\n- ${path.join(OUT_DIR, 'scrub-merged.md')}\n- ${path.join(OUT_DIR, 'scrub-merged.json')}`);
}

main();
// tools/scrubber/scrub-static.ts
/* eslint-disable */
import { Project, SyntaxKind, Node, JsxAttribute } from "ts-morph";
import globby from "globby";
import * as fs from "fs";
import * as path from "path";

type Finding = {
  file: string;
  kind: "NO_HANDLER" | "MISSING_API" | "MISSING_FN" | "ANCHOR_NO_HREF";
  line: number;
  column: number;
  snippet: string;
  detail: string;
};

const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "scrubber.config.json"), "utf8"));
const OUT_DIR = path.resolve(__dirname, cfg.reportOutDir || "./out");
fs.mkdirSync(OUT_DIR, { recursive: true });

const ROOTS = (cfg.globRoots || ["../.."]).map((p: string) => path.resolve(__dirname, p));
const SRC_GLOBS: string[] = cfg.sourceGlobs || ["**/*.{ts,tsx,js,jsx}", "!node_modules/**", "!**/*.d.ts"];

function existsAny(paths: string[]): boolean {
  return paths.some((p) => fs.existsSync(p));
}

function apiRouteExists(apiPath: string): boolean {
  // Normalize "/api/foo/bar" → check both app router and pages router
  const trimmed = apiPath.replace(/^\/+/, ""); // remove leading /
  const segs = trimmed.split("/").filter(Boolean); // ["api", "foo", "bar"]
  if (segs[0] !== "api") return true; // not an internal API

  const sub = segs.slice(1).join("/");

  const tryPaths: string[] = [];
  for (const root of cfg.nextAppApiRoots || []) {
    const base = path.resolve(__dirname, root, sub);
    tryPaths.push(`${base}/route.ts`, `${base}/route.js`);
  }
  for (const root of cfg.nextPagesApiRoots || []) {
    const base = path.resolve(__dirname, root, sub);
    tryPaths.push(`${base}.ts`, `${base}.js`);
  }
  return existsAny(tryPaths);
}

async function main() {
  const files = await globby(SRC_GLOBS, { cwd: ROOTS[0], absolute: true });
  const project = new Project({
    tsConfigFilePath: path.resolve(ROOTS[0], "tsconfig.json"),
    skipAddingFilesFromTsConfig: false
  });
  files.forEach((f) => project.addSourceFileAtPathIfExists(f));

  const findings: Finding[] = [];

  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant((node) => {
      // 1) <button> or elements with onClick
      if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
        const name = node.getTagNameNode().getText();
        const attrs = node.getAttributes().filter(Node.isJsxAttribute) as JsxAttribute[];

        const onClickAttr = attrs.find(a => a.getName() === "onClick");
        const hrefAttr = attrs.find(a => a.getName() === "href");

        const pos = node.getStartLinePos();
        const { line, column } = sf.getLineAndColumnAtPos(pos);
        const snippet = node.getText().slice(0, 200);

        // <a> without href & onClick
        if (name === "a" && !hrefAttr && !onClickAttr) {
          findings.push({
            file: sf.getFilePath(), kind: "ANCHOR_NO_HREF", line, column,
            snippet, detail: "<a> missing href and onClick"
          });
        }

        // <button> without onClick
        if (name === "button" && !onClickAttr) {
          findings.push({
            file: sf.getFilePath(), kind: "NO_HANDLER", line, column,
            snippet, detail: "<button> has no onClick"
          });
        }

        // onClick references missing identifier?
        if (onClickAttr) {
          const init = onClickAttr.getInitializer();
          if (init && Node.isJsxExpression(init)) {
            const expr = init.getExpression();
            if (expr && Node.isIdentifier(expr)) {
              const sym = expr.getSymbol();
              if (!sym || sym.getDeclarations().length === 0) {
                findings.push({
                  file: sf.getFilePath(), kind: "MISSING_FN", line, column,
                  snippet, detail: `onClick references missing identifier "${expr.getText()}"`
                });
              }
            }
          }
        }
      }

      // 2) fetch('/api/...') or axios('/api/...')
      if (Node.isCallExpression(node)) {
        const callee = node.getExpression().getText();
        if (callee === "fetch" || callee.endsWith(".get") || callee.endsWith(".post") || callee === "axios") {
          const arg = node.getArguments()[0];
          if (arg && Node.isStringLiteral(arg)) {
            const url = arg.getLiteralValue();
            if (typeof url === "string" && url.startsWith("/api/")) {
              if (!apiRouteExists(url)) {
                const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
                findings.push({
                  file: sf.getFilePath(), kind: "MISSING_API", line, column,
                  snippet: node.getText().slice(0, 200),
                  detail: `Frontend calls ${url} but no matching Next.js route found`
                });
              }
            }
          }
        }
      }
    });
  }

  // Write JSON + Markdown
  const jsonPath = path.join(OUT_DIR, "static-report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(findings, null, 2));

  let md = `# UI Action Scrub Report (Static)\n\nFindings: ${findings.length}\n\n| Kind | File | Line | Detail |\n|---|---|---:|---|\n`;
  for (const f of findings) {
    md += `| ${f.kind} | ${path.relative(process.cwd(), f.file)} | ${f.line} | ${f.detail} |\n`;
  }
  fs.writeFileSync(path.join(OUT_DIR, "static-report.md"), md);
}

main().catch((e) => { console.error(e); process.exit(1); });
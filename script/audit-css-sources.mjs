import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cssEntry = path.resolve(repoRoot, "client", "src", "index.css");
const css = fs.readFileSync(cssEntry, "utf8");

const result = await postcss([tailwindcss(), autoprefixer()]).process(css, {
  from: cssEntry,
});

const sourcelessDecls = [];
const riskyDecls = [];

result.root.walkDecls((decl) => {
  if (decl.source?.input?.file) return;
  const sample = {
    prop: decl.prop,
    value: decl.value,
    parent: decl.parent?.selector || decl.parent?.name || "?",
  };
  sourcelessDecls.push(sample);
  if (/url\(|image-set\(/i.test(decl.value)) {
    riskyDecls.push(sample);
  }
});

if (riskyDecls.length > 0) {
  console.error("CSS source audit failed: generated declarations without source metadata contain asset URLs.");
  console.error(JSON.stringify(riskyDecls, null, 2));
  process.exit(1);
}

console.log(`CSS source audit passed: ${sourcelessDecls.length} sourceless generated declaration(s), 0 asset-url risks.`);

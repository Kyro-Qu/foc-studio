import fs from "fs";
import path from "path";

const root = process.cwd();
const files = [];

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js")) files.push(p);
  }
}

walk(path.join(root, "js"));
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const re = /from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const cleanTarget = m[1].split("?")[0].split("#")[0];
    const target = path.resolve(path.dirname(f), cleanTarget);
    if (!fs.existsSync(target)) {
      console.log("MISSING", m[1], "in", path.relative(root, f));
      bad++;
    }
  }
}

// index.html script/css
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const ref of [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((x) => x[1])) {
  if (ref.startsWith("http") || ref.startsWith("#")) continue;
  const cleanRef = ref.split("?")[0].split("#")[0];
  const target = path.join(root, cleanRef);
  if (!fs.existsSync(target)) {
    console.log("MISSING asset", ref);
    bad++;
  }
}

console.log(bad === 0 ? "imports/assets OK" : bad + " problems");
process.exit(bad ? 1 : 0);

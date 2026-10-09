// NEYO — syntax check for every JavaScript file we ship.
// Run: npm run check:syntax
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const folders = ["api", "lib", "public", "scripts", "tests"];
const skip = new Set(["node_modules", "dist", ".git", "assets"]);

function walk(dir, out = []) {
    let names = [];
    try {
        names = readdirSync(dir);
    } catch {
        return out;
    }
    for (const name of names) {
        if (skip.has(name)) continue;
        const full = join(dir, name);
        const info = statSync(full);
        if (info.isDirectory()) walk(full, out);
        else if (/\.(m?js)$/.test(name) && !/\.min\.js$/.test(name)) out.push(full);
    }
    return out;
}

const files = folders.flatMap(folder => walk(join(root, folder)));
const failed = [];

for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
        failed.push(relative(root, file));
        console.error(`\n✗ ${relative(root, file)}\n${(result.stderr || "").trim()}`);
    }
}

if (failed.length) {
    console.error(`\n${failed.length} of ${files.length} files have syntax errors.`);
    process.exit(1);
}

console.log(`✓ ${files.length} JavaScript files passed the syntax check.`);

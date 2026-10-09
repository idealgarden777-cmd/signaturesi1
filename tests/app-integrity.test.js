// The page must never point at files that don't exist, and every API must load.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(join(root, "index.html"), "utf8");
const live = html.replace(/<!--[\s\S]*?-->/g, "");

test("every local script and stylesheet in index.html exists", () => {
    const refs = [...live.matchAll(/<(?:script[^>]+src|link[^>]+href)="(\/[^"?#]+)/g)].map(match => match[1]);
    assert.ok(refs.length > 20, "found the app's files");
    const missing = refs.filter(ref => !existsSync(join(root, ref)) && !existsSync(join(root, "public", ref)));
    assert.deepEqual(missing, []);
});

test("no duplicate element ids in index.html", () => {
    const ids = [...live.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    const seen = new Set();
    const dupes = new Set();
    for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
    assert.deepEqual([...dupes], []);
});

test("every settings tab has its panel", () => {
    const tabs = [...live.matchAll(/data-settings-tab="([a-z-]+)"/g)].map(match => match[1]);
    assert.ok(tabs.length >= 6);
    const panelFor = { general: "General", profile: "Profile", appearance: "Appearance", workspace: "Workspace", privacy: "Privacy", memory: "Memory", personalities: "Personalities", about: "About" };
    for (const tab of new Set(tabs)) {
        const id = `settingsPanel${panelFor[tab] || tab[0].toUpperCase() + tab.slice(1)}`;
        assert.ok(live.includes(`id="${id}"`), `${tab} → #${id}`);
    }
});

test("Vercel Hobby plan: at most 12 API functions", () => {
    const count = dir => readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) =>
        sum + (entry.isDirectory() ? count(join(dir, entry.name)) : /\.js$/.test(entry.name) ? 1 : 0), 0);
    assert.ok(count(join(root, "api")) <= 12);
});

test("every API route loads without crashing", async () => {
    const routes = [];
    const walk = dir => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".js")) routes.push(full);
        }
    };
    walk(join(root, "api"));
    for (const route of routes) {
        const mod = await import(route);
        assert.equal(typeof mod.default, "function", route);
    }
});

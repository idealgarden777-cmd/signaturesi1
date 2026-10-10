import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    CHARACTERS,
    CHARACTER_IDS,
    cleanCharacterName,
    characterDisplayName,
    characterTextPersona,
    characterVoicePersona,
    resolveCharacterId
} from "../lib/characters.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const browser = fs.readFileSync(path.join(ROOT, "public/js/characters/roster.js"), "utf8");
const browserIds = [...browser.matchAll(/\{ id: "([a-z]+)", name: "([^"]+)"[^}]*?kind: "(image|css)"/g)].map(m => ({ id: m[1], name: m[2], kind: m[3] }));

test("browser and server rosters list the same characters", () => {
    assert.equal(browserIds.length, 15);
    assert.deepEqual(browserIds.map(c => c.id).sort(), [...CHARACTER_IDS].sort());
    for (const c of browserIds) assert.equal(c.name, CHARACTERS[c.id].name);
});

test("every image character has its picture", () => {
    for (const c of browserIds.filter(c => c.kind === "image")) {
        const file = path.join(ROOT, "public/characters", `${c.id}.webp`);
        assert.ok(fs.existsSync(file), `${c.id}.webp missing`);
        assert.ok(fs.statSync(file).size < 60000, `${c.id}.webp too big`);
    }
});

test("every character has a voice, gender and persona", () => {
    const voices = new Set();
    for (const id of CHARACTER_IDS) {
        const c = CHARACTERS[id];
        assert.ok(["male", "female"].includes(c.gender), id);
        assert.match(c.voice, /^[A-Z][a-z]+$/);
        voices.add(c.voice);
        assert.match(characterTextPersona(id), new RegExp(`you are ${c.name}`));
        assert.match(characterVoicePersona(id), new RegExp(`You are ${c.name}`));
    }
    assert.equal(voices.size, CHARACTER_IDS.length, "each character sounds different");
});

test("custom names are cleaned and used", () => {
    assert.equal(cleanCharacterName("  Gul <script>  "), "Gul script");
    assert.equal(cleanCharacterName("a".repeat(40)).length, 20);
    assert.equal(characterDisplayName("neyo", "Gul"), "Gul");
    assert.equal(characterDisplayName("neyo", "<>"), "Neyo");
    assert.match(characterTextPersona("mimi", "Pinky"), /you are Pinky/);
    assert.equal(resolveCharacterId("unknown"), "neyo");
    assert.equal(resolveCharacterId("KOKO"), "koko");
});

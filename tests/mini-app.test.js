import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MINI_APP_HINT, MINI_APP_RULE, wantsMiniApp } from "../lib/mini-app.js";

const client = readFileSync(new URL("../public/js/components/mini-app.js", import.meta.url), "utf8");
const chat = readFileSync(new URL("../api/chat.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("mini app: build requests are noticed", () => {
    for (const text of [
        "snake game bana do",
        "ek drawing app banao",
        "make a tic tac toe game",
        "physics simulation bana do gravity wali",
        "piano bana do jo bajta ho",
        "Is mini app mein error aaya, theek karo"
    ]) assert.equal(wantsMiniApp(text), true, text);
});

test("mini app: normal questions are not apps", () => {
    for (const text of [
        "",
        "Pakistan ka capital kya hai?",
        "best tool for video editing konsa hai",
        "games ke baare mein batao",
        "mujhe neend nahi aati"
    ]) assert.equal(wantsMiniApp(text), false, text);
});

test("mini app: the model gets the rules", () => {
    assert.match(MINI_APP_HINT, /neyo-app/);
    assert.match(MINI_APP_RULE, /NO external files/);
    assert.match(MINI_APP_RULE, /var\(--accent\)/);
    assert.match(chat, /wantsMiniApp\(userText\)/);
    assert.match(chat, /preferences\.miniApp \|\|/);
});

test("mini app: sandbox stays locked", () => {
    const sandbox = client.match(/setAttribute\("sandbox", "([^"]+)"\)/)?.[1] || "";
    assert.ok(sandbox.includes("allow-scripts"));
    for (const bad of ["allow-same-origin", "allow-top-navigation", "allow-popups", "allow-downloads"]) {
        assert.ok(!sandbox.includes(bad), bad);
    }
    assert.match(client, /connect-src 'none'/);
    assert.match(client, /default-src 'none'/);
    // CSP goes first in <head>, before any app script
    assert.match(client, /\$\{match\}\$\{head\}/);
    // messages are only trusted from the app's own window
    assert.match(client, /frames\.get\(event\.source\)/);
    assert.match(html, /\/js\/components\/mini-app\.js\?v=\d+/);
    assert.match(html, /\/css\/components\/mini-app\.css\?v=\d+/);
});

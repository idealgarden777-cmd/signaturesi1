// Paid API routes must refuse strangers before spending the Gemini key.
import "./helpers/env.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeRes } from "./helpers/env.js";
import { takeRateLimit, resetRateLimits } from "../lib/guard.js";

const voiceToken = (await import("../api/voice-token.js")).default;
const transcribe = (await import("../api/transcribe.js")).default;

beforeEach(() => resetRateLimits());

const request = (headers = {}, body = {}) => ({
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body
});

test("voice token: logged-out request gets 401", async () => {
    const { res, out } = fakeRes();
    await voiceToken(request({ origin: "https://neyo.signaturesi.com" }, { character: "neyo" }), res);
    assert.equal(out.statusCode, 401);
});

test("voice token: other website gets 403", async () => {
    const { res, out } = fakeRes();
    await voiceToken(request({ origin: "https://evil.example" }, { character: "neyo" }), res);
    assert.equal(out.statusCode, 403);
});

test("voice search: logged-out request gets 401", async () => {
    const { res, out } = fakeRes();
    await voiceToken(request({}, { action: "search", query: "news" }), res);
    assert.equal(out.statusCode, 401);
});

test("voice token: GET is not allowed", async () => {
    const { res, out } = fakeRes();
    await voiceToken({ method: "GET", headers: {} }, res);
    assert.equal(out.statusCode, 405);
});

test("transcribe: logged-out request gets 401", async () => {
    const { res, out } = fakeRes();
    await transcribe(request({ origin: "https://neyo.signaturesi.com" }), res);
    assert.equal(out.statusCode, 401);
});

test("transcribe: other website gets 403", async () => {
    const { res, out } = fakeRes();
    await transcribe(request({ origin: "https://evil.example" }), res);
    assert.equal(out.statusCode, 403);
});

test("rate limit blocks after the limit and frees up later", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
        assert.equal(takeRateLimit("t:u1", 3, 60_000, now + i).ok, true);
    }
    const blocked = takeRateLimit("t:u1", 3, 60_000, now + 10);
    assert.equal(blocked.ok, false);
    assert.ok(blocked.retryAfterSec >= 1);
    assert.equal(takeRateLimit("t:u2", 3, 60_000, now + 10).ok, true, "other users are not affected");
    assert.equal(takeRateLimit("t:u1", 3, 60_000, now + 61_000).ok, true, "window passes");
});

// Settings > Memory API: user isolation, secret blocking, edit/delete/clear.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMemoryRequest, createMemoryFilter } from "../lib/memory.js";

function fakeDb(initial) {
    const db = { rows: initial.map(row => ({ ...row })) };
    db.client = {
        from() {
            const filters = [];
            let op = "select";
            let payload = null;
            const query = {
                select() { return query; },
                eq(key, value) { filters.push(row => row[key] === value); return query; },
                like(key, pattern) { const start = pattern.slice(0, -1); filters.push(row => String(row[key]).startsWith(start)); return query; },
                in(key, list) { filters.push(row => list.includes(row[key])); return query; },
                order() { return query; },
                limit() { return query; },
                delete() { op = "delete"; return query; },
                upsert(next) { op = "upsert"; payload = next; return query; },
                update() { op = "noop"; return query; },
                then(resolve, reject) {
                    let data = null;
                    const match = row => filters.every(fn => fn(row));
                    if (op === "select") data = db.rows.filter(match);
                    if (op === "delete") db.rows = db.rows.filter(row => !match(row));
                    if (op === "upsert") {
                        db.rows = db.rows.filter(row => !(row.user_id === payload.user_id && row.key === payload.key));
                        db.rows.push(payload);
                    }
                    return Promise.resolve({ data, error: null }).then(resolve, reject);
                }
            };
            return query;
        }
    };
    return db;
}

async function call(db, method, body, userId = "u") {
    const out = {};
    const res = {
        status(code) { out.status = code; return res; },
        json(json) { out.json = json; return res; },
        setHeader() { return res; }
    };
    await handleMemoryRequest({ method, body }, res, { supabase: db.client, userId });
    return out;
}

const seed = () => fakeDb([
    { user_id: "u", key: "user_name", value: "Mera naam Ali", updated_at: "2026-10-09T00:00:00Z" },
    { user_id: "u", key: "auto_x", value: "a\nb\nc", updated_at: "2026-10-08T00:00:00Z" },
    { user_id: "v", key: "user_other", value: "someone else", updated_at: "2026-10-08T00:00:00Z" }
]);

test("lists only my memories", async () => {
    const db = seed();
    const r = await call(db, "GET");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items.map(item => item.key).sort(), ["auto_x", "user_name"]);
});

test("saves new facts and keeps duplicates apart", async () => {
    const db = seed();
    const a = await call(db, "POST", { action: "save", value: "Mera naam Ali hai" });
    const b = await call(db, "POST", { action: "save", value: "Mera naam Ali hai" });
    assert.equal(a.status, 200);
    assert.notEqual(a.json.item.key, b.json.item.key);
});

test("refuses passwords, keys and card numbers", async () => {
    const db = seed();
    for (const value of ["password: abc123!", "my card 4111 1111 1111 1111", "key sk-abcdefghijklmnopqrstuvwxyz123456"]) {
        const r = await call(db, "POST", { action: "save", value });
        assert.equal(r.status, 400, value);
    }
});

test("edit, delete and forget everything touch only my rows", async () => {
    const db = seed();
    await call(db, "POST", { action: "save", key: "user_name", value: "Mera naam Samuel" });
    assert.equal(db.rows.find(row => row.key === "user_name").value, "Mera naam Samuel");
    await call(db, "POST", { action: "delete", key: "auto_x" });
    assert.ok(!db.rows.some(row => row.key === "auto_x"));
    await call(db, "POST", { action: "clear" });
    assert.deepEqual(db.rows.map(row => row.user_id), ["v"]);
});

test("unknown action and logged-out user are refused", async () => {
    const db = seed();
    assert.equal((await call(db, "POST", { action: "zzz" })).status, 400);
    assert.equal((await call(db, "GET", null, null)).status, 401);
});

test("memory filter hides hidden markers even when split across chunks", () => {
    const filter = createMemoryFilter(new Map());
    const text = 'Done.\n<<WS_ACTION {"type":"task","title":"A","body":"' + "x".repeat(900) + '"}>>';
    let visible = "";
    for (let i = 0; i < text.length; i += 5) visible += filter.push(text.slice(i, i + 5));
    visible += filter.flush();
    assert.equal(visible.trim(), "Done.");
    assert.equal(filter.result().actions.length, 1);
});

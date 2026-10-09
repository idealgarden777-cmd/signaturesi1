// NEYO Workspaces backend, end to end against a fake database.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
const ws = await import("../lib/workspaces.js");
const { createMemoryFilter } = await import("../lib/memory.js");
import crypto from "node:crypto";

const T = {}; // table -> rows
const uid = () => crypto.randomUUID();
const PK = { neyo_workspace_members: ["workspace_id", "user_id"], bean_conversation_members: ["conversation_id", "user_id"] };
const AUTO_ID = new Set(["neyo_workspaces", "neyo_workspace_items", "neyo_workspace_comments", "neyo_workspace_invites", "neyo_workspace_suggestions", "bean_conversations", "bean_messages", "neyo_workspace_activity"]);

function q(table) {
  T[table] ||= [];
  const st = { filters: [], op: "select", one: null, order: null, limit: null, count: false, head: false, returning: false };
  const api = {
    select(cols, opts = {}) { if (st.op === "select") st.op = "select"; else st.returning = true; if (opts.count) st.count = true; if (opts.head) st.head = true; return api; },
    eq(c, v) { st.filters.push(r => r[c] === v); return api; },
    in(c, v) { st.filters.push(r => v.includes(r[c])); return api; },
    is(c, v) { st.filters.push(r => (r[c] ?? null) === v); return api; },
    order(c, o = {}) { st.order = [c, o.ascending !== false]; return api; },
    limit(n) { st.limit = n; return api; },
    insert(rows) { st.op = "insert"; st.rows = Array.isArray(rows) ? rows : [rows]; return api; },
    upsert(rows) { st.op = "upsert"; st.rows = Array.isArray(rows) ? rows : [rows]; return api; },
    update(p) { st.op = "update"; st.patch = p; return api; },
    delete() { st.op = "delete"; return api; },
    maybeSingle() { st.one = "maybe"; return api; },
    single() { st.one = "single"; return api; },
    then(res, rej) { return new Promise(r => r(run())).then(res, rej); }
  };
  function run() {
    const rows = T[table];
    const match = r => st.filters.every(f => f(r));
    let out = [];
    if (st.op === "insert" || st.op === "upsert") {
      for (const r0 of st.rows) {
        const r = { ...r0 };
        if (AUTO_ID.has(table) && !r.id) r.id = table === "neyo_workspace_activity" ? rows.length + 1 : uid();
        r.created_at ||= new Date().toISOString();
        if (table === "neyo_workspace_items") { r.updated_at ||= r.created_at; r.status ??= null; r.priority ??= "normal"; }
        if (table === "neyo_workspace_invites") { r.uses ??= 0; r.revoked_at ??= null; }
        if (table === "neyo_workspace_suggestions") r.status ??= "pending";
        const pk = PK[table];
        if (pk && rows.some(x => pk.every(k => x[k] === r[k]))) {
          if (st.op === "upsert") continue;
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        rows.push(r); out.push(r);
      }
    } else if (st.op === "update") {
      out = rows.filter(match); out.forEach(r => Object.assign(r, st.patch));
    } else if (st.op === "delete") {
      out = rows.filter(match); T[table] = rows.filter(r => !match(r));
      if (table === "neyo_workspaces") for (const t of Object.keys(T)) if (t.startsWith("neyo_workspace_")) T[t] = T[t].filter(r => !out.some(w => w.id === r.workspace_id));
    } else {
      out = rows.filter(match);
      if (st.order) { const [c, asc] = st.order; out.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (st.limit) out = out.slice(0, st.limit);
    }
    if (st.count) return { data: st.head ? null : out, count: out.length, error: null };
    if (st.one === "single") return out[0] ? { data: out[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
    if (st.one === "maybe") return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
  return api;
}
const files = new Map();
const fake = {
  from: q,
  storage: { from: () => ({
    download: async p => files.has(p) ? { data: new Blob([files.get(p)]), error: null } : { data: null, error: new Error("nf") },
    remove: async ps => { ps.forEach(p => files.delete(p)); return { error: null }; },
    createSignedUrl: async p => ({ data: { signedUrl: "https://signed/" + p }, error: null })
  }) }
};
ws.__setDb(fake);

const U = n => ({ id: uid(), username: n, display_name: n[0].toUpperCase() + n.slice(1), status: "active" });
const sam = U("samuel"), ali = U("ali"), sara = U("sara"), bob = U("bob");
T.bean_users = [sam, ali, sara, bob];
T.bean_presence = [{ user_id: ali.id, last_seen_at: new Date().toISOString() }];
const me = u => ({ userId: u.id, username: u.username, displayName: u.display_name });

async function call(u, body, method = "POST", query = {}) {
  let status = 0, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; } };
  await ws.handleWorkspaces({ method, body, query }, res, { me: me(u) });
  return { status, json };
}
let fails = 0;
const failures = [];
const ok = (cond, label, extra) => { if (!cond) { fails++; failures.push(label + " " + (extra === undefined ? "" : JSON.stringify(extra).slice(0, 200))); } };

let r = await call(sam, { action: "create", name: "Ideal Garden Project", description: "Garden" });
ok(r.status === 200 && r.json.workspace.role === "owner", "create", r.json);
const W = r.json.workspace.id;
ok(r.json.workspace.hasBean && T.bean_conversation_members.length === 1, "bean group made");
r = await call(sam, { action: "add_member", id: W, beanId: "@ali", role: "admin" });
ok(r.status === 200 && r.json.members.length === 2, "add ali", r.json);
r = await call(sam, { action: "add_member", id: W, beanId: "ali" });
ok(r.status === 409, "dup member 409", r.json);
r = await call(sam, { action: "add_member", id: W, beanId: "nobody" });
ok(r.status === 404, "unknown bean id 404");
ok(T.bean_conversation_members.length === 2, "ali in bean group");
r = await call(ali, { action: "add_member", id: W, beanId: "sara", role: "viewer" });
ok(r.status === 200, "admin adds viewer");
r = await call(sara, { action: "add_item", id: W, kind: "task", title: "x" });
ok(r.status === 403, "viewer cannot add", r.json);
r = await call(ali, { action: "add_item", id: W, kind: "task", title: "Quotation", assigneeId: sam.id, due: "2020-01-01", priority: "high" });
ok(r.status === 200 && r.json.items[0].overdue && r.json.items[0].priority === "high", "task with due/priority/overdue", r.json.items?.[0]);
const task = r.json.items[0].id;
r = await call(ali, { action: "add_item", id: W, kind: "task", title: "y", assigneeId: sara.id });
ok(r.json.items.find(i=>i.title==="y").assignee === null, "viewer can't be assignee");
r = await call(sam, { action: "update_item", id: W, itemId: task, status: "done" });
ok(r.json.items.find(i => i.id === task).status === "done", "status done");
ok(T.bean_messages.some(m => /finished: Quotation/.test(m.body)), "bean told about done", JSON.stringify(T.bean_messages.map(m=>m.body)));
r = await call(ali, { action: "add_comment", id: W, itemId: task, body: "Looks good" });
ok(r.json.items.find(i => i.id === task).comments.length === 1, "comment");
r = await call(sara, { action: "add_comment", id: W, itemId: task, body: "hi" });
ok(r.status === 403, "viewer no comment");
// invite
r = await call(sam, { action: "create_invite", id: W, role: "member" });
ok(r.status === 200 && /\?join=/.test(r.json.inviteUrl), "invite link");
const token = r.json.inviteUrl.split("join=")[1];
r = await call(bob, { action: "join", token });
ok(r.status === 200 && r.json.joined && r.json.workspace.role === "member", "bob joins", r.json);
r = await call(bob, { action: "join", token });
ok(r.status === 200 && !r.json.joined, "join twice ok");
r = await call(bob, { action: "join", token: "bad" });
ok(r.status === 404, "bad token");
// files
const path = `users/${sam.id}/u1/boq.csv`;
files.set(path, "item,qty\nplants,40\n");
r = await call(sam, { action: "add_file", id: W, path, name: "boq.csv", size: 22, mime: "text/csv" });
ok(r.status === 200 && r.json.items.find(i => i.kind === "file").textChars > 0, "csv file read", r.json.fileNote || r.json);
r = await call(sam, { action: "add_file", id: W, path: `users/${ali.id}/x/a.txt`, name: "a.txt" });
ok(r.status === 400, "foreign path refused");
const fileId = T.neyo_workspace_items.find(i => i.kind === "file").id;
r = await call(sara, { action: "file_url", id: W, itemId: fileId });
ok(r.status === 200 && r.json.url.includes(path), "viewer can open file");
// suggestions
const sugg = await ws.saveWorkspaceSuggestions(W, ali.id, [{ type: "task", title: "Site visit", assignee: "@bob", due: "2026-10-12" }, { type: "decision", title: "Option B" }, { title: "" }]);
ok(sugg.length === 2, "suggestions saved", sugg);
ok((await ws.saveWorkspaceSuggestions(W, sara.id, [{ type: "task", title: "z" }])).length === 0, "viewer suggestions ignored");
r = await call(bob, { action: "decide", id: W, suggestionIds: sugg.map(s => s.id), decision: "approve" });
ok(r.status === 200 && r.json.made === 0, "member can't approve others' suggestions", r.json.made);
r = await call(ali, { action: "decide", id: W, suggestionId: sugg[0].id, decision: "approve" });
const sv = r.json.items.find(i => i.title === "Site visit");
ok(sv && sv.assignee?.beanId === "bob" && sv.due === "2026-10-12", "approved -> task with assignee", sv);
r = await call(sam, { action: "decide", id: W, suggestionId: sugg[1].id, decision: "reject" });
ok(r.json.suggestions.length === 0 && !r.json.items.some(i => i.title === "Option B"), "rejected");
// list
r = await call(sam, {}, "GET", {});
ok(r.json.workspaces[0].myOpenTasks === 0 && r.json.workspaces[0].members === 4, "list counts", r.json.workspaces[0]);
r = await call(bob, {}, "GET", {});
ok(r.json.workspaces[0].myOpenTasks === 1, "bob has 1 open task");
// context
const ctx = await ws.loadWorkspaceContext(W, bob.id, "site visit kab hai");
ok(ctx && /Site visit/.test(ctx.text) && /FILE "boq.csv"/.test(ctx.text) && /@bob/.test(ctx.text), "context", ctx?.text?.slice(0, 300));
ok((await ws.loadWorkspaceContext(W, uid(), "x")) === null, "non-member no context");
// roles
r = await call(ali, { action: "remove_member", id: W, userId: sam.id });
ok(r.status === 400, "can't remove owner");
r = await call(sam, { action: "transfer_owner", id: W, userId: ali.id });
ok(r.json.members.find(m => m.id === ali.id).role === "owner" && r.json.workspace.role === "admin", "transfer owner");
r = await call(sam, { action: "remove_member", id: W });
ok(r.json.left, "sam leaves");
r = await call(sam, {}, "GET", { id: W });
ok(r.status === 404, "after leave 404");
r = await call(ali, { action: "remove_member", id: W, userId: bob.id });
ok(r.status === 200 && !T.neyo_workspace_items.some(i => i.assignee_id === bob.id), "removed member tasks unassigned");
r = await call(ali, { action: "delete", id: W });
ok(r.json.deleted && !files.has(path) && T.neyo_workspace_items.length === 0, "delete ws + files");
r = await call(ali, { action: "nope" });
ok(r.status === 400, "unknown action");

// stream filter with WS_ACTION split
const f = createMemoryFilter(new Map());
const text = 'Done.\n<<WS_ACTION {"type":"task","title":"A","body":"' + "x".repeat(900) + '"}>>';
let vis = ""; for (let i = 0; i < text.length; i += 5) vis += f.push(text.slice(i, i + 5)); vis += f.flush();
ok(vis === "Done.\n" || vis === "Done." , "filter hides long action", JSON.stringify(vis.slice(0, 40)));
ok(f.result().actions.length === 1, "filter caught action");
test("workspaces: roles, invites, tasks, files, approvals, Bean sync", () => {
  assert.deepEqual(failures, []);
  assert.equal(fails, 0);
});

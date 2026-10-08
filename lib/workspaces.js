/* =========================================================
   NEYO WORKSPACES (v1)
   A shared project space: members (Bean IDs, roles), tasks,
   notes, decisions, files (text), activity. Linked to Bean:
   every workspace gets its own Bean group chat.
   Served by /api/history?resource=workspaces (no new Vercel
   function). NEYO reads a workspace as context in chat.
   ========================================================= */
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "./auth.js";

const BEAN_URL = "https://bean.signaturesi.com";
const ROLES = ["owner", "admin", "member", "viewer"];
const KINDS = ["task", "note", "decision", "file"];
const STATUSES = ["todo", "doing", "done"];
const MAX_MEMBERS = 50;
const MAX_ITEMS = 300;
const ONLINE_MS = 35000;

let client = null;
function db() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}

class WsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new WsError(status, message);
};

const text = (value, max) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const cleanBeanId = value =>
  String(value || "").trim().toLowerCase().replace(/^@/, "").replace(/@bean$/, "");
const isUuid = value => /^[0-9a-f-]{36}$/i.test(String(value || ""));
const rank = role => ({ owner: 4, admin: 3, member: 2, viewer: 1 })[role] || 0;

function missingTable(error) {
  return error && (error.code === "42P01" || /does not exist|schema cache/i.test(error.message || ""));
}
function check(error) {
  if (!error) return;
  if (missingTable(error)) {
    fail(503, "Workspaces are not set up yet: run supabase/neyo_workspaces.sql once in Supabase.");
  }
  throw error;
}

async function membership(workspaceId, userId) {
  if (!isUuid(workspaceId)) fail(400, "Workspace id is missing.");
  const { data, error } = await db()
    .from("neyo_workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  check(error);
  if (!data) fail(404, "Workspace not found.");
  return data.role;
}

async function needRole(workspaceId, userId, min) {
  const role = await membership(workspaceId, userId);
  if (rank(role) < rank(min)) {
    fail(403, min === "member" ? "Viewers can only look." : "Only the owner or an admin can do that.");
  }
  return role;
}

async function logActivity(workspaceId, userId, action, detail = "") {
  await db()
    .from("neyo_workspace_activity")
    .insert({ workspace_id: workspaceId, user_id: userId, action: text(action, 60), detail: text(detail, 300) })
    .then(() => null, () => null);
  await db()
    .from("neyo_workspaces")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", workspaceId)
    .then(() => null, () => null);
}

/* ---------------- Bean link ---------------- */

async function beanSystemMessage(conversationId, body, senderId) {
  try {
    const { data: message } = await db()
      .from("bean_messages")
      .insert({ conversation_id: conversationId, sender_id: senderId, kind: "system", body })
      .select("id, created_at")
      .single();
    if (message) {
      await db()
        .from("bean_conversations")
        .update({
          updated_at: message.created_at,
          last_message: body.slice(0, 140),
          last_sender_id: senderId,
          last_message_id: message.id
        })
        .eq("id", conversationId);
    }
  } catch {}
}

// Creates the workspace's Bean group (once) with every member in it.
async function ensureBeanGroup(workspace, me) {
  if (workspace.bean_conversation_id) return workspace.bean_conversation_id;
  try {
    const { data: conv, error } = await db()
      .from("bean_conversations")
      .insert({ type: "group", title: text(workspace.name, 60), created_by: me.userId })
      .select("id")
      .single();
    if (error || !conv) return null;
    const { data: members } = await db()
      .from("neyo_workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspace.id);
    const rows = (members || []).map(m => ({
      conversation_id: conv.id,
      user_id: m.user_id,
      role: m.role === "owner" || m.role === "admin" ? "admin" : "member"
    }));
    if (rows.length) await db().from("bean_conversation_members").insert(rows);
    await beanSystemMessage(conv.id, `${me.displayName || me.username} created "${text(workspace.name, 60)}" from NEYO Workspace`, me.userId);
    await db().from("neyo_workspaces").update({ bean_conversation_id: conv.id }).eq("id", workspace.id);
    return conv.id;
  } catch {
    return null;
  }
}

async function beanAddMember(conversationId, userId, role, note, me) {
  if (!conversationId) return;
  try {
    await db()
      .from("bean_conversation_members")
      .upsert(
        { conversation_id: conversationId, user_id: userId, role: role === "admin" || role === "owner" ? "admin" : "member" },
        { onConflict: "conversation_id,user_id", ignoreDuplicates: true }
      );
    if (note) await beanSystemMessage(conversationId, note, me.userId);
  } catch {}
}

async function beanRemoveMember(conversationId, userId, note, me) {
  if (!conversationId) return;
  try {
    await db().from("bean_conversation_members").delete().eq("conversation_id", conversationId).eq("user_id", userId);
    if (note) await beanSystemMessage(conversationId, note, me.userId);
  } catch {}
}

/* ---------------- Reads ---------------- */

async function users(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const [{ data: list }, { data: presence }] = await Promise.all([
    db().from("bean_users").select("id, username, display_name").in("id", unique),
    db().from("bean_presence").select("user_id, last_seen_at").in("user_id", unique).then(r => r, () => ({ data: [] }))
  ]);
  const seen = new Map((presence || []).map(p => [p.user_id, p.last_seen_at]));
  return new Map(
    (list || []).map(u => {
      const last = seen.get(u.id) || null;
      return [
        u.id,
        {
          id: u.id,
          beanId: u.username,
          name: u.display_name || u.username,
          lastSeen: last,
          online: last ? Date.now() - new Date(last).getTime() < ONLINE_MS : false
        }
      ];
    })
  );
}

async function listWorkspaces(me) {
  const { data: mine, error } = await db()
    .from("neyo_workspace_members")
    .select("workspace_id, role")
    .eq("user_id", me.userId);
  check(error);
  const ids = (mine || []).map(m => m.workspace_id);
  if (!ids.length) return { workspaces: [] };
  const [{ data: rows, error: e2 }, { data: counts }] = await Promise.all([
    db().from("neyo_workspaces").select("id, name, description, updated_at").in("id", ids).order("updated_at", { ascending: false }),
    db().from("neyo_workspace_members").select("workspace_id").in("workspace_id", ids)
  ]);
  check(e2);
  const roleOf = new Map(mine.map(m => [m.workspace_id, m.role]));
  const countOf = new Map();
  (counts || []).forEach(c => countOf.set(c.workspace_id, (countOf.get(c.workspace_id) || 0) + 1));
  return {
    workspaces: (rows || []).map(w => ({
      id: w.id,
      name: w.name,
      description: w.description || "",
      role: roleOf.get(w.id),
      members: countOf.get(w.id) || 1,
      updatedAt: w.updated_at
    }))
  };
}

async function getWorkspace(me, id) {
  const role = await membership(id, me.userId);
  const [{ data: ws, error }, { data: members }, { data: items }, { data: activity }] = await Promise.all([
    db().from("neyo_workspaces").select("*").eq("id", id).single(),
    db().from("neyo_workspace_members").select("user_id, role, joined_at").eq("workspace_id", id),
    db().from("neyo_workspace_items").select("*").eq("workspace_id", id).order("created_at", { ascending: false }).limit(MAX_ITEMS),
    db().from("neyo_workspace_activity").select("*").eq("workspace_id", id).order("created_at", { ascending: false }).limit(40)
  ]);
  check(error);
  const people = await users([
    ...(members || []).map(m => m.user_id),
    ...(items || []).map(i => i.assignee_id),
    ...(items || []).map(i => i.created_by),
    ...(activity || []).map(a => a.user_id)
  ]);
  const person = uid => people.get(uid) || { id: uid, beanId: "", name: "Someone", online: false };
  const order = { owner: 0, admin: 1, member: 2, viewer: 3 };
  return {
    workspace: {
      id: ws.id,
      name: ws.name,
      description: ws.description || "",
      instructions: ws.instructions || "",
      role,
      ownerId: ws.owner_id,
      beanUrl: ws.bean_conversation_id ? `${BEAN_URL}/chat#${ws.bean_conversation_id}` : null,
      createdAt: ws.created_at,
      updatedAt: ws.updated_at
    },
    members: (members || [])
      .map(m => ({ ...person(m.user_id), role: m.role, joinedAt: m.joined_at, you: m.user_id === me.userId }))
      .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name)),
    items: (items || []).map(i => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      body: i.kind === "file" ? "" : i.body || "",
      size: i.kind === "file" ? (i.body || "").length : undefined,
      file: i.file || null,
      status: i.status,
      assignee: i.assignee_id ? person(i.assignee_id) : null,
      createdBy: i.created_by ? person(i.created_by).name : "",
      createdAt: i.created_at,
      updatedAt: i.updated_at
    })),
    activity: (activity || []).map(a => ({
      who: person(a.user_id).name,
      action: a.action,
      detail: a.detail,
      at: a.created_at
    }))
  };
}

/* ---------------- Writes ---------------- */

async function createWorkspace(me, body) {
  const name = text(body.name, 80);
  if (!name) fail(400, "Give the workspace a name.");
  const { data: ws, error } = await db()
    .from("neyo_workspaces")
    .insert({ owner_id: me.userId, name, description: text(body.description, 2000) })
    .select("*")
    .single();
  check(error);
  const { error: e2 } = await db()
    .from("neyo_workspace_members")
    .insert({ workspace_id: ws.id, user_id: me.userId, role: "owner", added_by: me.userId });
  check(e2);
  await logActivity(ws.id, me.userId, "created the workspace", name);
  await ensureBeanGroup(ws, me);
  return getWorkspace(me, ws.id);
}

async function updateWorkspace(me, body) {
  await needRole(body.id, me.userId, "admin");
  const patch = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    patch.name = text(body.name, 80);
    if (!patch.name) fail(400, "Name can't be empty.");
  }
  if (body.description !== undefined) patch.description = text(body.description, 2000);
  if (body.instructions !== undefined) patch.instructions = text(body.instructions, 3000);
  const { data: ws, error } = await db().from("neyo_workspaces").update(patch).eq("id", body.id).select("*").single();
  check(error);
  if (patch.name && ws.bean_conversation_id) {
    await db().from("bean_conversations").update({ title: patch.name.slice(0, 60) }).eq("id", ws.bean_conversation_id).then(() => null, () => null);
  }
  await logActivity(body.id, me.userId, "updated the workspace details");
  return getWorkspace(me, body.id);
}

async function deleteWorkspace(me, body) {
  await needRole(body.id, me.userId, "owner");
  const { error } = await db().from("neyo_workspaces").delete().eq("id", body.id);
  check(error);
  return { deleted: true };
}

async function workspaceRow(id) {
  const { data, error } = await db().from("neyo_workspaces").select("*").eq("id", id).single();
  check(error);
  return data;
}

async function addMember(me, body) {
  await needRole(body.id, me.userId, "admin");
  const beanId = cleanBeanId(body.beanId);
  if (!beanId) fail(400, "Write a Bean ID.");
  const role = ["admin", "member", "viewer"].includes(body.role) ? body.role : "member";
  const { data: user, error } = await db()
    .from("bean_users")
    .select("id, username, display_name, status")
    .eq("username", beanId)
    .maybeSingle();
  check(error);
  if (!user || user.status !== "active") fail(404, `No Bean account found for @${beanId}.`);
  const { count } = await db()
    .from("neyo_workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", body.id);
  if ((count || 0) >= MAX_MEMBERS) fail(400, "This workspace is full.");
  const { error: e2 } = await db()
    .from("neyo_workspace_members")
    .insert({ workspace_id: body.id, user_id: user.id, role, added_by: me.userId });
  if (e2 && e2.code === "23505") fail(409, `@${beanId} is already in this workspace.`);
  check(e2);
  const ws = await workspaceRow(body.id);
  const conv = await ensureBeanGroup(ws, me);
  await beanAddMember(conv, user.id, role, `${me.displayName || me.username} added ${user.display_name || user.username}`, me);
  await logActivity(body.id, me.userId, `added ${user.display_name || user.username}`, role);
  return getWorkspace(me, body.id);
}

async function setRole(me, body) {
  const myRole = await needRole(body.id, me.userId, "admin");
  const role = ["admin", "member", "viewer"].includes(body.role) ? body.role : null;
  if (!role) fail(400, "Pick a role.");
  const target = await membership(body.id, body.userId).catch(() => fail(404, "Member not found."));
  if (target === "owner") fail(400, "The owner's role can't change.");
  if (myRole === "admin" && target === "admin" && body.userId !== me.userId) fail(403, "Only the owner can change an admin.");
  const { error } = await db()
    .from("neyo_workspace_members")
    .update({ role })
    .eq("workspace_id", body.id)
    .eq("user_id", body.userId);
  check(error);
  const ws = await workspaceRow(body.id);
  if (ws.bean_conversation_id) {
    await db()
      .from("bean_conversation_members")
      .update({ role: role === "admin" ? "admin" : "member" })
      .eq("conversation_id", ws.bean_conversation_id)
      .eq("user_id", body.userId)
      .then(() => null, () => null);
  }
  const who = (await users([body.userId])).get(body.userId);
  await logActivity(body.id, me.userId, `made ${who?.name || "a member"} ${role}`);
  return getWorkspace(me, body.id);
}

async function removeMember(me, body) {
  const leaving = !body.userId || body.userId === me.userId;
  const targetId = leaving ? me.userId : body.userId;
  const target = await membership(body.id, targetId);
  if (target === "owner") fail(400, leaving ? "The owner can't leave. Delete the workspace instead." : "The owner can't be removed.");
  if (!leaving) {
    const myRole = await needRole(body.id, me.userId, "admin");
    if (myRole === "admin" && target === "admin") fail(403, "Only the owner can remove an admin.");
  }
  const { error } = await db().from("neyo_workspace_members").delete().eq("workspace_id", body.id).eq("user_id", targetId);
  check(error);
  const ws = await workspaceRow(body.id);
  const who = (await users([targetId])).get(targetId);
  await beanRemoveMember(ws.bean_conversation_id, targetId, leaving ? `${who?.name || "Someone"} left` : `${me.displayName || me.username} removed ${who?.name || "a member"}`, me);
  await logActivity(body.id, me.userId, leaving ? "left the workspace" : `removed ${who?.name || "a member"}`);
  return leaving ? { left: true } : getWorkspace(me, body.id);
}

async function assigneeOk(workspaceId, assigneeId) {
  if (!assigneeId) return null;
  if (!isUuid(assigneeId)) return null;
  const { data } = await db()
    .from("neyo_workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", assigneeId)
    .maybeSingle();
  return data ? assigneeId : null;
}

const KIND_WORD = { task: "task", note: "note", decision: "decision", file: "file" };

async function addItem(me, body) {
  await needRole(body.id, me.userId, "member");
  const kind = KINDS.includes(body.kind) ? body.kind : null;
  if (!kind) fail(400, "Unknown item type.");
  const title = text(body.title, 200);
  if (!title) fail(400, "Write a title.");
  const row = {
    workspace_id: body.id,
    kind,
    title,
    body: text(body.body, kind === "file" ? 60000 : 8000),
    status: kind === "task" ? (STATUSES.includes(body.status) ? body.status : "todo") : null,
    assignee_id: kind === "task" ? await assigneeOk(body.id, body.assigneeId) : null,
    file: kind === "file" && body.file
      ? { name: text(body.file.name, 200), size: Number(body.file.size) || 0, type: text(body.file.type, 100) }
      : null,
    created_by: me.userId
  };
  const { error } = await db().from("neyo_workspace_items").insert(row);
  check(error);
  await logActivity(body.id, me.userId, `added a ${KIND_WORD[kind]}`, title);
  return getWorkspace(me, body.id);
}

async function updateItem(me, body) {
  await needRole(body.id, me.userId, "member");
  const { data: item, error } = await db()
    .from("neyo_workspace_items")
    .select("*")
    .eq("id", body.itemId)
    .eq("workspace_id", body.id)
    .maybeSingle();
  check(error);
  if (!item) fail(404, "Item not found.");
  const patch = { updated_at: new Date().toISOString() };
  if (body.title !== undefined) patch.title = text(body.title, 200) || item.title;
  if (body.body !== undefined && item.kind !== "file") patch.body = text(body.body, 8000);
  if (item.kind === "task") {
    if (STATUSES.includes(body.status)) patch.status = body.status;
    if (body.assigneeId !== undefined) patch.assignee_id = await assigneeOk(body.id, body.assigneeId);
  }
  const { error: e2 } = await db().from("neyo_workspace_items").update(patch).eq("id", item.id);
  check(e2);
  const what = patch.status && patch.status !== item.status
    ? `moved a task to ${({ todo: "To do", doing: "In progress", done: "Done" })[patch.status]}`
    : `edited a ${KIND_WORD[item.kind]}`;
  await logActivity(body.id, me.userId, what, patch.title || item.title);
  return getWorkspace(me, body.id);
}

async function deleteItem(me, body) {
  await needRole(body.id, me.userId, "member");
  const { data: item } = await db()
    .from("neyo_workspace_items")
    .select("kind, title")
    .eq("id", body.itemId)
    .eq("workspace_id", body.id)
    .maybeSingle();
  if (!item) fail(404, "Item not found.");
  const { error } = await db().from("neyo_workspace_items").delete().eq("id", body.itemId).eq("workspace_id", body.id);
  check(error);
  await logActivity(body.id, me.userId, `deleted a ${KIND_WORD[item.kind]}`, item.title);
  return getWorkspace(me, body.id);
}

async function openBean(me, body) {
  await membership(body.id, me.userId);
  const ws = await workspaceRow(body.id);
  const conv = await ensureBeanGroup(ws, me);
  if (!conv) fail(503, "Bean chat is not set up yet (Bean tables missing).");
  await beanAddMember(conv, me.userId, "member", "", me);
  return { url: `${BEAN_URL}/chat#${conv}` };
}

/* ---------------- HTTP ---------------- */

export async function handleWorkspaces(req, res) {
  try {
    const me = await getAuthenticatedUser(req);
    if (!me?.userId) return res.status(401).json({ error: "Please log in." });

    if (req.method === "GET") {
      const id = req.query?.id;
      return res.status(200).json(id ? await getWorkspace(me, id) : await listWorkspaces(me));
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const actions = {
      create: createWorkspace,
      update: updateWorkspace,
      delete: deleteWorkspace,
      add_member: addMember,
      set_role: setRole,
      remove_member: removeMember,
      add_item: addItem,
      update_item: updateItem,
      delete_item: deleteItem,
      open_bean: openBean
    };
    const run = actions[body.action];
    if (!run) return res.status(400).json({ error: "Unknown action." });
    return res.status(200).json(await run(me, body));
  } catch (error) {
    if (error instanceof WsError) return res.status(error.status).json({ error: error.message });
    console.error("[WORKSPACE] error", error?.message || error);
    return res.status(500).json({ error: "Workspace request failed." });
  }
}

/* ---------------- Context for NEYO chat ---------------- */

// Returns a text block that tells NEYO what this workspace is about.
// Empty string when the user is not a member or tables are missing.
export async function loadWorkspaceContext(workspaceId, userId, question = "", budget = 9000) {
  try {
    if (!isUuid(workspaceId) || !userId) return null;
    const { data: mine } = await db()
      .from("neyo_workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!mine) return null;

    const [{ data: ws }, { data: members }, { data: items }] = await Promise.all([
      db().from("neyo_workspaces").select("name, description, instructions").eq("id", workspaceId).single(),
      db().from("neyo_workspace_members").select("user_id, role").eq("workspace_id", workspaceId),
      db().from("neyo_workspace_items").select("kind, title, body, status, assignee_id, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(MAX_ITEMS)
    ]);
    if (!ws) return null;
    const people = await users([...(members || []).map(m => m.user_id), ...(items || []).map(i => i.assignee_id)]);
    const nameOf = uid => (people.get(uid)?.name || "someone");
    const me = people.get(userId);

    const lines = [
      `WORKSPACE "${ws.name}" (shared project space in NEYO, linked to a Bean group chat). The user (${me?.name || "user"}, role ${mine.role}) is working inside it. Use this context in your answer; don't repeat it back unless asked. If the workspace doesn't cover something, say so instead of guessing.`
    ];
    if (ws.description) lines.push(`About: ${ws.description}`);
    if (ws.instructions) lines.push(`Workspace instructions (follow them): ${ws.instructions}`);
    lines.push(
      "Members: " +
        (members || []).map(m => `${nameOf(m.user_id)} @${people.get(m.user_id)?.beanId || "?"} (${m.role})`).join(", ")
    );

    const all = items || [];
    const words = new Set(
      String(question || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2)
    );
    const score = i => {
      const hay = `${i.title} ${i.kind === "file" ? i.title : i.body || ""}`.toLowerCase();
      let n = 0;
      words.forEach(w => { if (hay.includes(w)) n += 1; });
      return n;
    };

    const tasks = all.filter(i => i.kind === "task");
    if (tasks.length) {
      const label = { todo: "To do", doing: "In progress", done: "Done" };
      lines.push(
        "Tasks:\n" +
          tasks
            .sort((a, b) => (a.status === "done") - (b.status === "done"))
            .slice(0, 40)
            .map(t => `- [${label[t.status] || "To do"}] ${t.title}${t.assignee_id ? ` → ${nameOf(t.assignee_id)}` : ""}${t.body ? `: ${t.body.slice(0, 160)}` : ""}`)
            .join("\n")
      );
    }
    const decisions = all.filter(i => i.kind === "decision").slice(0, 25);
    if (decisions.length) {
      lines.push("Decisions made:\n" + decisions.map(d => `- ${d.title}${d.body ? `: ${d.body.slice(0, 300)}` : ""}`).join("\n"));
    }

    let used = lines.join("\n\n").length;
    const notes = all.filter(i => i.kind === "note").sort((a, b) => score(b) - score(a));
    const noteLines = [];
    for (const n of notes) {
      const line = `- ${n.title}: ${String(n.body || "").slice(0, 1200)}`;
      if (used + line.length > budget * 0.55) break;
      noteLines.push(line);
      used += line.length;
    }
    if (noteLines.length) lines.push("Notes:\n" + noteLines.join("\n"));

    const files = all.filter(i => i.kind === "file").sort((a, b) => score(b) - score(a));
    if (files.length) {
      lines.push("Files: " + files.map(f => f.title).join(", "));
      for (const f of files) {
        const room = budget - used - 200;
        if (room < 400) break;
        const content = String(f.body || "").slice(0, Math.min(room, 6000));
        if (!content) continue;
        lines.push(`FILE "${f.title}"${content.length < (f.body || "").length ? " (start)" : ""}:\n${content}`);
        used += content.length + f.title.length + 20;
      }
    }

    return { name: ws.name, text: lines.join("\n\n").slice(0, budget + 1500) };
  } catch (error) {
    console.warn("[WORKSPACE] context failed", error?.message || error);
    return null;
  }
}

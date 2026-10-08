/* =========================================================
   NEYO WORKSPACES v2
   Shared project space for people + NEYO, linked to Bean.
   - Members (Bean IDs) with Owner / Admin / Member / Viewer
   - Invite links
   - Tasks (status, assignee, due date, priority), notes,
     decisions, saved AI answers, files (PDF, Word, Excel,
     CSV, text, images) with comments
   - NEYO suggestions that a human Approves / Rejects
   - Activity history, and updates posted in the Bean group
   Served by /api/history?resource=workspaces (no new Vercel
   function). NEYO reads a workspace as context in chat.
   ========================================================= */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "./auth.js";

const BEAN_URL = "https://bean.signaturesi.com";
const APP_URL = "https://neyo.signaturesi.com";
const FILE_BUCKET = "neyo-attachments";
const KINDS = ["task", "note", "decision", "file", "ai"];
const STATUSES = ["todo", "doing", "done"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const STATUS_LABEL = { todo: "To do", doing: "In progress", done: "Done" };
const KIND_WORD = { task: "task", note: "note", decision: "decision", file: "file", ai: "NEYO answer" };
const MAX_MEMBERS = 50;
const MAX_ITEMS = 400;
const MAX_FILE_TEXT = 60000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ONLINE_MS = 35000;
const INVITE_DAYS = 7;

let client = null;
function db() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}
// tests only
export function __setDb(fake) {
  client = fake;
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
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
const rank = role => ({ owner: 4, admin: 3, member: 2, viewer: 1 })[role] || 0;
const nameOfMe = me => me.displayName || me.username || "Someone";
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");

function cleanDate(value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

function missingTable(error) {
  return error && (error.code === "42P01" || error.code === "42703" || error.code === "PGRST204" || /does not exist|schema cache/i.test(error.message || ""));
}
function check(error) {
  if (!error) return;
  if (missingTable(error)) {
    fail(503, "Workspaces need a database update: run supabase/neyo_workspaces.sql once in Supabase.");
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
    fail(403, min === "member" ? "Viewers can only look." : min === "owner" ? "Only the owner can do that." : "Only the owner or an admin can do that.");
  }
  return role;
}

async function workspaceRow(id) {
  const { data, error } = await db().from("neyo_workspaces").select("*").eq("id", id).single();
  check(error);
  return data;
}

async function logActivity(workspaceId, userId, action, detail = "") {
  try {
    await db()
      .from("neyo_workspace_activity")
      .insert({ workspace_id: workspaceId, user_id: userId, action: text(action, 80), detail: text(detail, 300) });
    await db().from("neyo_workspaces").update({ updated_at: new Date().toISOString() }).eq("id", workspaceId);
  } catch {}
}

/* ---------------- Bean link ---------------- */

async function beanSystemMessage(conversationId, body, senderId) {
  if (!conversationId || !body) return;
  try {
    const { data: message } = await db()
      .from("bean_messages")
      .insert({ conversation_id: conversationId, sender_id: senderId, kind: "system", body: text(body, 900) })
      .select("id, created_at")
      .single();
    if (message) {
      await db()
        .from("bean_conversations")
        .update({
          updated_at: message.created_at,
          last_message: text(body, 140),
          last_sender_id: senderId,
          last_message_id: message.id
        })
        .eq("id", conversationId);
    }
  } catch {}
}

// Short update in the workspace's Bean group ("🗂️ Ali added a task: …").
async function tellBean(workspaceId, me, line) {
  try {
    const { data } = await db().from("neyo_workspaces").select("bean_conversation_id").eq("id", workspaceId).maybeSingle();
    if (data?.bean_conversation_id) await beanSystemMessage(data.bean_conversation_id, `🗂️ ${line}`, me.userId);
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
    await beanSystemMessage(conv.id, `${nameOfMe(me)} created "${text(workspace.name, 60)}" from NEYO Workspace`, me.userId);
    await db().from("neyo_workspaces").update({ bean_conversation_id: conv.id }).eq("id", workspace.id);
    workspace.bean_conversation_id = conv.id;
    return conv.id;
  } catch {
    return null;
  }
}

async function beanAddMember(conversationId, userId, role) {
  if (!conversationId) return;
  try {
    await db()
      .from("bean_conversation_members")
      .upsert(
        { conversation_id: conversationId, user_id: userId, role: role === "admin" || role === "owner" ? "admin" : "member" },
        { onConflict: "conversation_id,user_id", ignoreDuplicates: true }
      );
  } catch {}
}

async function beanRemoveMember(conversationId, userId) {
  if (!conversationId) return;
  try {
    await db().from("bean_conversation_members").delete().eq("conversation_id", conversationId).eq("user_id", userId);
  } catch {}
}

/* ---------------- People ---------------- */

async function users(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const [{ data: list }, presence] = await Promise.all([
    db().from("bean_users").select("id, username, display_name").in("id", unique),
    db().from("bean_presence").select("user_id, last_seen_at").in("user_id", unique).then(r => r?.data || [], () => [])
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

async function addPerson(workspaceId, user, role, me) {
  const { count } = await db()
    .from("neyo_workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if ((count || 0) >= MAX_MEMBERS) fail(400, "This workspace is full (50 members).");
  const { error } = await db()
    .from("neyo_workspace_members")
    .insert({ workspace_id: workspaceId, user_id: user.id, role, added_by: me.userId });
  if (error && error.code === "23505") fail(409, `@${user.username} is already in this workspace.`);
  check(error);
  const ws = await workspaceRow(workspaceId);
  const conv = await ensureBeanGroup(ws, me);
  await beanAddMember(conv, user.id, role);
}

/* ---------------- Reads ---------------- */

async function listWorkspaces(me) {
  const { data: mine, error } = await db()
    .from("neyo_workspace_members")
    .select("workspace_id, role")
    .eq("user_id", me.userId);
  check(error);
  const ids = (mine || []).map(m => m.workspace_id);
  if (!ids.length) return { workspaces: [] };
  const [{ data: rows, error: e2 }, { data: counts }, { data: myTasks }, pending] = await Promise.all([
    db().from("neyo_workspaces").select("id, name, description, updated_at").in("id", ids).order("updated_at", { ascending: false }),
    db().from("neyo_workspace_members").select("workspace_id").in("workspace_id", ids),
    db().from("neyo_workspace_items").select("workspace_id, status").in("workspace_id", ids).eq("kind", "task").eq("assignee_id", me.userId),
    db().from("neyo_workspace_suggestions").select("workspace_id").in("workspace_id", ids).eq("status", "pending").then(r => r?.data || [], () => [])
  ]);
  check(e2);
  const roleOf = new Map(mine.map(m => [m.workspace_id, m.role]));
  const tally = list => {
    const map = new Map();
    (list || []).forEach(x => map.set(x.workspace_id, (map.get(x.workspace_id) || 0) + 1));
    return map;
  };
  const countOf = tally(counts);
  const taskOf = tally((myTasks || []).filter(t => t.status !== "done"));
  const pendingOf = tally(pending);
  return {
    workspaces: (rows || []).map(w => ({
      id: w.id,
      name: w.name,
      description: w.description || "",
      role: roleOf.get(w.id),
      members: countOf.get(w.id) || 1,
      myOpenTasks: taskOf.get(w.id) || 0,
      pending: pendingOf.get(w.id) || 0,
      updatedAt: w.updated_at
    }))
  };
}

async function getWorkspace(me, id) {
  const role = await membership(id, me.userId);
  const [{ data: ws, error }, { data: members }, { data: items, error: e3 }, { data: activity }, comments, suggestions, invites] = await Promise.all([
    db().from("neyo_workspaces").select("*").eq("id", id).single(),
    db().from("neyo_workspace_members").select("user_id, role, joined_at").eq("workspace_id", id),
    db().from("neyo_workspace_items").select("id, kind, title, body, status, priority, due_date, assignee_id, file, created_by, created_at, updated_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(MAX_ITEMS),
    db().from("neyo_workspace_activity").select("*").eq("workspace_id", id).order("created_at", { ascending: false }).limit(60),
    db().from("neyo_workspace_comments").select("id, item_id, user_id, body, created_at").eq("workspace_id", id).order("created_at", { ascending: true }).limit(1000).then(r => r?.data || [], () => []),
    db().from("neyo_workspace_suggestions").select("id, requested_by, payload, status, created_at").eq("workspace_id", id).eq("status", "pending").order("created_at", { ascending: false }).limit(50).then(r => r?.data || [], () => []),
    rank(role) >= 3
      ? db().from("neyo_workspace_invites").select("id, role, expires_at, uses, max_uses, revoked_at, created_at").eq("workspace_id", id).is("revoked_at", null).order("created_at", { ascending: false }).limit(20).then(r => r?.data || [], () => [])
      : Promise.resolve([])
  ]);
  check(error);
  check(e3);
  const people = await users([
    ...(members || []).map(m => m.user_id),
    ...(items || []).map(i => i.assignee_id),
    ...(items || []).map(i => i.created_by),
    ...(activity || []).map(a => a.user_id),
    ...comments.map(c => c.user_id),
    ...suggestions.map(s => s.requested_by)
  ]);
  const person = uid => people.get(uid) || { id: uid, beanId: "", name: "Someone", online: false };
  const order = { owner: 0, admin: 1, member: 2, viewer: 3 };
  const commentsByItem = new Map();
  comments.forEach(c => {
    const list = commentsByItem.get(c.item_id) || [];
    list.push({ id: c.id, who: person(c.user_id).name, userId: c.user_id, body: c.body, at: c.created_at });
    commentsByItem.set(c.item_id, list);
  });
  const now = Date.now();
  return {
    workspace: {
      id: ws.id,
      name: ws.name,
      description: ws.description || "",
      instructions: ws.instructions || "",
      role,
      ownerId: ws.owner_id,
      hasBean: Boolean(ws.bean_conversation_id),
      beanUrl: ws.bean_conversation_id ? `${BEAN_URL}/chat#${ws.bean_conversation_id}` : null,
      createdAt: ws.created_at,
      updatedAt: ws.updated_at
    },
    me: { id: me.userId },
    members: (members || [])
      .map(m => ({ ...person(m.user_id), role: m.role, joinedAt: m.joined_at, you: m.user_id === me.userId }))
      .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name)),
    items: (items || []).map(i => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      body: i.kind === "file" ? "" : i.body || "",
      textChars: i.kind === "file" ? (i.body || "").length : undefined,
      file: i.file ? { name: i.file.name, size: i.file.size, type: i.file.type, stored: Boolean(i.file.path) } : null,
      status: i.kind === "task" ? i.status || "todo" : null,
      priority: i.priority || "normal",
      due: i.due_date || null,
      overdue: i.kind === "task" && i.status !== "done" && i.due_date ? new Date(`${i.due_date}T23:59:59`).getTime() < now : false,
      assignee: i.assignee_id ? person(i.assignee_id) : null,
      createdBy: i.created_by ? person(i.created_by).name : "",
      createdById: i.created_by || null,
      comments: commentsByItem.get(i.id) || [],
      createdAt: i.created_at,
      updatedAt: i.updated_at
    })),
    suggestions: suggestions.map(s => ({
      id: s.id,
      ...cleanSuggestion(s.payload),
      requestedBy: person(s.requested_by).name,
      requestedById: s.requested_by,
      at: s.created_at
    })),
    invites: invites.map(v => ({
      id: v.id,
      role: v.role,
      uses: v.uses,
      maxUses: v.max_uses,
      expiresAt: v.expires_at,
      expired: new Date(v.expires_at).getTime() < now || v.uses >= v.max_uses
    })),
    activity: (activity || []).map(a => ({
      who: person(a.user_id).name,
      action: a.action,
      detail: a.detail,
      at: a.created_at
    }))
  };
}

/* ---------------- Workspace ---------------- */

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
    try {
      await db().from("bean_conversations").update({ title: patch.name.slice(0, 60) }).eq("id", ws.bean_conversation_id);
    } catch {}
  }
  await logActivity(body.id, me.userId, body.instructions !== undefined && body.name === undefined ? "updated NEYO's instructions" : "updated the workspace details");
  return getWorkspace(me, body.id);
}

async function deleteWorkspace(me, body) {
  await needRole(body.id, me.userId, "owner");
  const { data: files } = await db().from("neyo_workspace_items").select("file").eq("workspace_id", body.id).eq("kind", "file");
  const paths = (files || []).map(f => f.file?.path).filter(Boolean);
  const { error } = await db().from("neyo_workspaces").delete().eq("id", body.id);
  check(error);
  if (paths.length) {
    try {
      await db().storage.from(FILE_BUCKET).remove(paths);
    } catch {}
  }
  return { deleted: true };
}

/* ---------------- Members ---------------- */

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
  await addPerson(body.id, user, role, me);
  const who = user.display_name || user.username;
  await logActivity(body.id, me.userId, `added ${who}`, role);
  await tellBean(body.id, me, `${nameOfMe(me)} added ${who} to the workspace (${role})`);
  return getWorkspace(me, body.id);
}

async function setRole(me, body) {
  const myRole = await needRole(body.id, me.userId, "admin");
  const role = ["admin", "member", "viewer"].includes(body.role) ? body.role : null;
  if (!role) fail(400, "Pick a role.");
  if (!isUuid(body.userId)) fail(400, "Member not found.");
  let target;
  try {
    target = await membership(body.id, body.userId);
  } catch {
    fail(404, "Member not found.");
  }
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
    try {
      await db()
        .from("bean_conversation_members")
        .update({ role: role === "admin" ? "admin" : "member" })
        .eq("conversation_id", ws.bean_conversation_id)
        .eq("user_id", body.userId);
    } catch {}
  }
  const who = (await users([body.userId])).get(body.userId);
  await logActivity(body.id, me.userId, `made ${who?.name || "a member"} ${role}`);
  return getWorkspace(me, body.id);
}

async function removeMember(me, body) {
  const leaving = !body.userId || body.userId === me.userId;
  const targetId = leaving ? me.userId : body.userId;
  if (!isUuid(targetId)) fail(400, "Member not found.");
  const target = await membership(body.id, targetId);
  if (target === "owner") fail(400, leaving ? "The owner can't leave. Delete the workspace, or make someone else owner first." : "The owner can't be removed.");
  if (!leaving) {
    const myRole = await needRole(body.id, me.userId, "admin");
    if (myRole === "admin" && target === "admin") fail(403, "Only the owner can remove an admin.");
  }
  const { error } = await db().from("neyo_workspace_members").delete().eq("workspace_id", body.id).eq("user_id", targetId);
  check(error);
  // their open tasks become unassigned
  try {
    await db().from("neyo_workspace_items").update({ assignee_id: null }).eq("workspace_id", body.id).eq("assignee_id", targetId);
  } catch {}
  const ws = await workspaceRow(body.id);
  const who = (await users([targetId])).get(targetId);
  await beanRemoveMember(ws.bean_conversation_id, targetId);
  await beanSystemMessage(ws.bean_conversation_id, leaving ? `${who?.name || "Someone"} left` : `${nameOfMe(me)} removed ${who?.name || "a member"}`, me.userId);
  await logActivity(body.id, me.userId, leaving ? "left the workspace" : `removed ${who?.name || "a member"}`);
  return leaving ? { left: true } : getWorkspace(me, body.id);
}

async function transferOwner(me, body) {
  await needRole(body.id, me.userId, "owner");
  if (!isUuid(body.userId) || body.userId === me.userId) fail(400, "Pick another member.");
  await membership(body.id, body.userId);
  const { error } = await db().from("neyo_workspace_members").update({ role: "owner" }).eq("workspace_id", body.id).eq("user_id", body.userId);
  check(error);
  await db().from("neyo_workspace_members").update({ role: "admin" }).eq("workspace_id", body.id).eq("user_id", me.userId);
  await db().from("neyo_workspaces").update({ owner_id: body.userId }).eq("id", body.id);
  const who = (await users([body.userId])).get(body.userId);
  await logActivity(body.id, me.userId, `made ${who?.name || "a member"} the owner`);
  await tellBean(body.id, me, `${who?.name || "A member"} is now the workspace owner`);
  return getWorkspace(me, body.id);
}

/* ---------------- Invites ---------------- */

async function createInvite(me, body) {
  await needRole(body.id, me.userId, "admin");
  const role = ["admin", "member", "viewer"].includes(body.role) ? body.role : "member";
  const token = crypto.randomBytes(18).toString("base64url");
  const { error } = await db().from("neyo_workspace_invites").insert({
    workspace_id: body.id,
    token_hash: hash(token),
    role,
    created_by: me.userId,
    expires_at: new Date(Date.now() + INVITE_DAYS * 86400000).toISOString(),
    max_uses: Math.min(Math.max(Number(body.maxUses) || 25, 1), 100)
  });
  check(error);
  await logActivity(body.id, me.userId, "created an invite link", role);
  const data = await getWorkspace(me, body.id);
  return { ...data, inviteUrl: `${APP_URL}/?join=${token}` };
}

async function revokeInvite(me, body) {
  await needRole(body.id, me.userId, "admin");
  const { error } = await db()
    .from("neyo_workspace_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", body.inviteId)
    .eq("workspace_id", body.id);
  check(error);
  return getWorkspace(me, body.id);
}

async function joinByInvite(me, body) {
  const token = text(body.token, 100);
  if (!token) fail(400, "Invite link is missing.");
  const { data: invite, error } = await db()
    .from("neyo_workspace_invites")
    .select("*")
    .eq("token_hash", hash(token))
    .maybeSingle();
  check(error);
  if (!invite || invite.revoked_at) fail(404, "This invite link is not valid any more.");
  if (new Date(invite.expires_at).getTime() < Date.now()) fail(410, "This invite link has expired. Ask for a new one.");
  if (invite.uses >= invite.max_uses) fail(410, "This invite link has been used up. Ask for a new one.");
  const { data: already } = await db()
    .from("neyo_workspace_members")
    .select("role")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", me.userId)
    .maybeSingle();
  if (!already) {
    const { data: user } = await db().from("bean_users").select("id, username, display_name").eq("id", me.userId).maybeSingle();
    await addPerson(invite.workspace_id, user || { id: me.userId, username: me.username }, invite.role, { ...me, userId: invite.created_by || me.userId });
    await db().from("neyo_workspace_invites").update({ uses: invite.uses + 1 }).eq("id", invite.id);
    await logActivity(invite.workspace_id, me.userId, "joined with an invite link", invite.role);
    await tellBean(invite.workspace_id, me, `${nameOfMe(me)} joined the workspace`);
  }
  const data = await getWorkspace(me, invite.workspace_id);
  return { ...data, joined: !already };
}

/* ---------------- Items ---------------- */

async function assigneeOk(workspaceId, assigneeId) {
  if (!assigneeId || !isUuid(assigneeId)) return null;
  const { data } = await db()
    .from("neyo_workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", assigneeId)
    .maybeSingle();
  return data && data.role !== "viewer" ? assigneeId : null;
}

async function insertItem(workspaceId, me, input) {
  const kind = KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) fail(400, "Unknown item type.");
  const title = text(input.title, 200);
  if (!title) fail(400, "Write a title.");
  const row = {
    workspace_id: workspaceId,
    kind,
    title,
    body: text(input.body, kind === "file" ? MAX_FILE_TEXT : 8000),
    status: kind === "task" ? (STATUSES.includes(input.status) ? input.status : "todo") : null,
    priority: PRIORITIES.includes(input.priority) ? input.priority : "normal",
    due_date: kind === "task" ? cleanDate(input.due) : null,
    assignee_id: kind === "task" ? await assigneeOk(workspaceId, input.assigneeId) : null,
    file: input.file || null,
    created_by: me.userId
  };
  const { count } = await db()
    .from("neyo_workspace_items")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if ((count || 0) >= MAX_ITEMS) fail(400, "This workspace is full (400 items). Delete old ones first.");
  const { data, error } = await db().from("neyo_workspace_items").insert(row).select("id").single();
  check(error);
  return { ...row, id: data?.id };
}

async function announceItem(workspaceId, me, row, viaNeyo = false) {
  const by = viaNeyo ? `${nameOfMe(me)} (approved NEYO's suggestion)` : nameOfMe(me);
  await logActivity(workspaceId, me.userId, `${viaNeyo ? "approved NEYO's" : "added a"} ${KIND_WORD[row.kind]}`, row.title);
  if (row.kind === "task") {
    const who = row.assignee_id ? (await users([row.assignee_id])).get(row.assignee_id)?.name : null;
    await tellBean(workspaceId, me, `${by} added a task: ${row.title}${who ? ` → ${who}` : ""}${row.due_date ? ` (due ${row.due_date})` : ""}`);
  } else if (row.kind === "decision") {
    await tellBean(workspaceId, me, `Decision by ${by}: ${row.title}`);
  } else if (row.kind === "file") {
    await tellBean(workspaceId, me, `${by} added a file: ${row.title}`);
  }
}

async function addItem(me, body) {
  await needRole(body.id, me.userId, "member");
  if (body.kind === "file") fail(400, "Upload files with the Add files button.");
  const row = await insertItem(body.id, me, body);
  await announceItem(body.id, me, row);
  return getWorkspace(me, body.id);
}

async function itemRow(workspaceId, itemId) {
  if (!isUuid(itemId)) fail(404, "Item not found.");
  const { data, error } = await db()
    .from("neyo_workspace_items")
    .select("*")
    .eq("id", itemId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  check(error);
  if (!data) fail(404, "Item not found.");
  return data;
}

async function updateItem(me, body) {
  await needRole(body.id, me.userId, "member");
  const item = { ...(await itemRow(body.id, body.itemId)) };
  const patch = { updated_at: new Date().toISOString() };
  if (body.title !== undefined) patch.title = text(body.title, 200) || item.title;
  if (body.body !== undefined && item.kind !== "file") patch.body = text(body.body, 8000);
  if (PRIORITIES.includes(body.priority)) patch.priority = body.priority;
  if (item.kind === "task") {
    if (STATUSES.includes(body.status)) patch.status = body.status;
    if (body.assigneeId !== undefined) patch.assignee_id = await assigneeOk(body.id, body.assigneeId);
    if (body.due !== undefined) patch.due_date = cleanDate(body.due);
  }
  const { error } = await db().from("neyo_workspace_items").update(patch).eq("id", item.id);
  check(error);
  const title = patch.title || item.title;
  if (patch.status && patch.status !== item.status) {
    await logActivity(body.id, me.userId, `moved a task to ${STATUS_LABEL[patch.status]}`, title);
    if (patch.status === "done") await tellBean(body.id, me, `${nameOfMe(me)} finished: ${title} ✅`);
  } else if (patch.assignee_id !== undefined && patch.assignee_id !== item.assignee_id && patch.assignee_id) {
    const who = (await users([patch.assignee_id])).get(patch.assignee_id)?.name || "someone";
    await logActivity(body.id, me.userId, `assigned a task to ${who}`, title);
    await tellBean(body.id, me, `${nameOfMe(me)} assigned "${title}" to ${who}`);
  } else {
    await logActivity(body.id, me.userId, `edited a ${KIND_WORD[item.kind]}`, title);
  }
  return getWorkspace(me, body.id);
}

async function deleteItem(me, body) {
  const role = await needRole(body.id, me.userId, "member");
  const item = await itemRow(body.id, body.itemId);
  if (rank(role) < 3 && item.created_by !== me.userId) fail(403, "Only the person who added it, or an admin, can delete it.");
  const { error } = await db().from("neyo_workspace_items").delete().eq("id", item.id).eq("workspace_id", body.id);
  check(error);
  if (item.kind === "file" && item.file?.path) {
    try {
      await db().storage.from(FILE_BUCKET).remove([item.file.path]);
    } catch {}
  }
  await logActivity(body.id, me.userId, `deleted a ${KIND_WORD[item.kind]}`, item.title);
  return getWorkspace(me, body.id);
}

async function addComment(me, body) {
  await needRole(body.id, me.userId, "member");
  const item = await itemRow(body.id, body.itemId);
  const words = text(body.body, 2000);
  if (!words) fail(400, "Write a comment.");
  const { error } = await db()
    .from("neyo_workspace_comments")
    .insert({ workspace_id: body.id, item_id: item.id, user_id: me.userId, body: words });
  check(error);
  await logActivity(body.id, me.userId, `commented on "${text(item.title, 60)}"`, text(words, 120));
  return getWorkspace(me, body.id);
}

async function deleteComment(me, body) {
  const role = await needRole(body.id, me.userId, "member");
  if (!isUuid(body.commentId)) fail(404, "Comment not found.");
  const { data: comment } = await db()
    .from("neyo_workspace_comments")
    .select("id, user_id")
    .eq("id", body.commentId)
    .eq("workspace_id", body.id)
    .maybeSingle();
  if (!comment) fail(404, "Comment not found.");
  if (comment.user_id !== me.userId && rank(role) < 3) fail(403, "You can only delete your own comments.");
  const { error } = await db().from("neyo_workspace_comments").delete().eq("id", comment.id);
  check(error);
  return getWorkspace(me, body.id);
}

/* ---------------- Files ---------------- */

async function addFile(me, body) {
  await needRole(body.id, me.userId, "member");
  const path = text(body.path, 600);
  const prefix = `users/${me.userId}/`;
  if (!path.startsWith(prefix) || path.includes("..")) fail(400, "Upload the file first.");
  const name = text(body.name, 200) || path.split("/").pop();
  const ext = (name.split(".").pop() || "").toLowerCase();
  const mime = text(body.mime, 120);
  const size = Number(body.size) || 0;
  let content = "";
  let note = "";
  const isImage = /^image\//.test(mime) || ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "svg"].includes(ext);
  const isMedia = /^(audio|video)\//.test(mime) || ["mp3", "wav", "m4a", "mp4", "mov", "webm"].includes(ext);
  if (!isImage && !isMedia) {
    if (size > MAX_FILE_BYTES) {
      note = "too big to read";
    } else {
      try {
        const { data, error } = await db().storage.from(FILE_BUCKET).download(path);
        if (error || !data) throw error || new Error("missing");
        const buffer = Buffer.from(await data.arrayBuffer());
        const { extractAttachment } = await import("./attachments/extractors.js");
        const result = await extractAttachment({ buffer, name, mime, extension: ext, category: "" });
        content = String(result?.text || "").replace(/\u0000/g, "").trim();
        if (!content) note = "no readable text";
      } catch (error) {
        console.warn("[WORKSPACE] file read failed", name, error?.message || error);
        note = "couldn't read";
      }
    }
  }
  const cut = content.length > MAX_FILE_TEXT;
  const row = await insertItem(body.id, me, {
    kind: "file",
    title: name,
    body: content.slice(0, MAX_FILE_TEXT),
    file: { name, size, type: mime || ext, path }
  });
  await announceItem(body.id, me, row);
  const data = await getWorkspace(me, body.id);
  return {
    ...data,
    fileNote: isImage || isMedia
      ? "saved"
      : note
        ? `saved, but NEYO ${note === "too big to read" ? "can't read files over 25 MB" : `couldn't read its text (${note})`}`
        : cut
          ? `saved; NEYO reads the first ${MAX_FILE_TEXT.toLocaleString("en-US")} characters`
          : "saved; NEYO can read it"
  };
}

async function fileUrl(me, body) {
  await membership(body.id, me.userId);
  const item = await itemRow(body.id, body.itemId);
  if (item.kind !== "file" || !item.file?.path) fail(404, "This file has no stored copy.");
  const { data, error } = await db().storage.from(FILE_BUCKET).createSignedUrl(item.file.path, 600, { download: item.file.name || true });
  if (error || !data?.signedUrl) fail(500, "Couldn't open the file.");
  return { url: data.signedUrl };
}

/* ---------------- NEYO suggestions (approval) ---------------- */

function cleanSuggestion(payload = {}) {
  const type = ["task", "decision", "note"].includes(payload.type) ? payload.type : "note";
  return {
    type,
    title: text(payload.title, 200),
    body: text(payload.body, 4000),
    assignee: cleanBeanId(payload.assignee),
    due: cleanDate(payload.due),
    priority: PRIORITIES.includes(payload.priority) ? payload.priority : "normal"
  };
}

// Called by api/chat.js with the actions NEYO wrote in its answer.
export async function saveWorkspaceSuggestions(workspaceId, userId, actions = []) {
  try {
    if (!isUuid(workspaceId) || !userId || !actions.length) return [];
    const role = await membership(workspaceId, userId).catch(() => null);
    if (!role || rank(role) < rank("member")) return [];
    const rows = actions
      .map(cleanSuggestion)
      .filter(a => a.title)
      .slice(0, 8)
      .map(payload => ({ workspace_id: workspaceId, requested_by: userId, payload }));
    if (!rows.length) return [];
    const { data, error } = await db().from("neyo_workspace_suggestions").insert(rows).select("id, payload");
    if (error) {
      console.warn("[WORKSPACE] suggestions not saved", error.message);
      return [];
    }
    return (data || []).map(s => ({ id: s.id, ...cleanSuggestion(s.payload) }));
  } catch (error) {
    console.warn("[WORKSPACE] suggestions failed", error?.message || error);
    return [];
  }
}

async function decideSuggestion(me, body) {
  const role = await needRole(body.id, me.userId, "member");
  const ids = (Array.isArray(body.suggestionIds) ? body.suggestionIds : [body.suggestionId]).filter(isUuid).slice(0, 20);
  if (!ids.length) fail(400, "Pick a suggestion.");
  const approve = body.decision === "approve";
  const { data: list, error } = await db()
    .from("neyo_workspace_suggestions")
    .select("*")
    .eq("workspace_id", body.id)
    .eq("status", "pending")
    .in("id", ids);
  check(error);
  if (!list?.length) fail(404, "Already decided.");
  let made = 0;
  for (const s of list) {
    if (s.requested_by !== me.userId && rank(role) < 3) continue; // only the asker or an admin decides
    const p = cleanSuggestion(s.payload);
    let itemId = null;
    if (approve && p.title) {
      let assigneeId = null;
      if (p.type === "task" && p.assignee) {
        const { data: u } = await db().from("bean_users").select("id").eq("username", p.assignee).maybeSingle();
        assigneeId = u?.id || null;
      }
      const row = await insertItem(body.id, me, {
        kind: p.type,
        title: p.title,
        body: p.body,
        priority: p.priority,
        due: p.due,
        assigneeId
      });
      itemId = row.id;
      await announceItem(body.id, me, row, true);
      made += 1;
    }
    await db()
      .from("neyo_workspace_suggestions")
      .update({ status: approve ? "approved" : "rejected", decided_by: me.userId, decided_at: new Date().toISOString(), item_id: itemId })
      .eq("id", s.id);
  }
  if (!approve) await logActivity(body.id, me.userId, `rejected ${list.length === 1 ? "a NEYO suggestion" : `${list.length} NEYO suggestions`}`);
  const data = await getWorkspace(me, body.id);
  return { ...data, made };
}

/* ---------------- Bean ---------------- */

async function openBean(me, body) {
  await membership(body.id, me.userId);
  const ws = await workspaceRow(body.id);
  const conv = await ensureBeanGroup(ws, me);
  if (!conv) fail(503, "Bean chat is not set up yet (Bean tables missing).");
  await beanAddMember(conv, me.userId, "member");
  return { url: `${BEAN_URL}/chat#${conv}` };
}

/* ---------------- HTTP ---------------- */

const ACTIONS = {
  create: createWorkspace,
  update: updateWorkspace,
  delete: deleteWorkspace,
  add_member: addMember,
  set_role: setRole,
  remove_member: removeMember,
  transfer_owner: transferOwner,
  create_invite: createInvite,
  revoke_invite: revokeInvite,
  join: joinByInvite,
  add_item: addItem,
  update_item: updateItem,
  delete_item: deleteItem,
  add_comment: addComment,
  delete_comment: deleteComment,
  add_file: addFile,
  file_url: fileUrl,
  decide: decideSuggestion,
  open_bean: openBean
};

export async function handleWorkspaces(req, res, options = {}) {
  try {
    const me = options.me || (await getAuthenticatedUser(req));
    if (!me?.userId) return res.status(401).json({ error: "Please log in." });

    if (req.method === "GET") {
      const id = req.query?.id;
      return res.status(200).json(id ? await getWorkspace(me, String(id)) : await listWorkspaces(me));
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    body = body && typeof body === "object" ? body : {};
    const run = ACTIONS[body.action];
    if (!run) return res.status(400).json({ error: "Unknown action." });
    return res.status(200).json(await run(me, body));
  } catch (error) {
    if (error instanceof WsError) return res.status(error.status).json({ error: error.message });
    console.error("[WORKSPACE] error", error?.message || error);
    return res.status(500).json({ error: "Workspace request failed. Please try again." });
  }
}

/* ---------------- Context for NEYO chat ---------------- */

export const WORKSPACE_RULE =
  "WORKSPACE ACTIONS: You can't change the workspace yourself, but you can SUGGEST changes that a person approves. " +
  "When the user asks you to add/create/plan tasks, record a decision, or save a note in the workspace (or it clearly helps and they agreed), " +
  "write your normal answer, then at the very end add one line per change: " +
  '<<WS_ACTION {"type":"task","title":"short title","body":"details","assignee":"beanid","due":"YYYY-MM-DD","priority":"low|normal|high|urgent"}>> ' +
  '(type is "task", "decision" or "note"; only include fields you know; assignee must be a member\'s Bean ID from the member list; at most 8). ' +
  "These lines are hidden from the user and shown as Approve / Reject cards, so in your answer say you've suggested them for approval. Never claim something was added or sent before it is approved. Don't add WS_ACTION lines when the user only asks a question.";

// Returns { name, text } that tells NEYO what this workspace is about,
// or null when the user is not a member or tables are missing.
export async function loadWorkspaceContext(workspaceId, userId, question = "", budget = 10000) {
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
      db().from("neyo_workspace_items").select("kind, title, body, status, priority, due_date, assignee_id, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(MAX_ITEMS)
    ]);
    if (!ws) return null;
    const people = await users([...(members || []).map(m => m.user_id), ...(items || []).map(i => i.assignee_id)]);
    const nameOf = uid => people.get(uid)?.name || "someone";
    const me = people.get(userId);

    const lines = [
      `WORKSPACE "${ws.name}" (a shared project space in NEYO, linked to a Bean group chat). The user is ${me?.name || "a member"} (@${me?.beanId || "?"}, role ${mine.role}). Use this context in your answer; don't repeat it back unless asked. If the workspace doesn't cover something, say so instead of guessing.`
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
      const hay = `${i.title} ${i.body || ""}`.slice(0, 20000).toLowerCase();
      let n = 0;
      words.forEach(w => {
        if (hay.includes(w)) n += 1;
      });
      return n;
    };

    const tasks = all.filter(i => i.kind === "task");
    if (tasks.length) {
      const today = new Date().toISOString().slice(0, 10);
      const order = { doing: 0, todo: 1, done: 2 };
      lines.push(
        "Tasks:\n" +
          tasks
            .sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1))
            .slice(0, 50)
            .map(t => {
              const late = t.status !== "done" && t.due_date && t.due_date < today ? " OVERDUE" : "";
              return `- [${STATUS_LABEL[t.status] || "To do"}${t.priority && t.priority !== "normal" ? `, ${t.priority}` : ""}${t.due_date ? `, due ${t.due_date}${late}` : ""}] ${t.title}${t.assignee_id ? ` → ${nameOf(t.assignee_id)}` : " (unassigned)"}${t.body ? `: ${t.body.slice(0, 160)}` : ""}`;
            })
            .join("\n")
      );
    }
    const decisions = all.filter(i => i.kind === "decision").slice(0, 30);
    if (decisions.length) {
      lines.push("Decisions made:\n" + decisions.map(d => `- ${d.title}${d.body ? `: ${d.body.slice(0, 300)}` : ""} (${String(d.created_at).slice(0, 10)})`).join("\n"));
    }

    let used = lines.join("\n\n").length;
    const notes = all.filter(i => i.kind === "note" || i.kind === "ai").sort((a, b) => score(b) - score(a));
    const noteLines = [];
    for (const n of notes) {
      const line = `- ${n.kind === "ai" ? "(saved NEYO answer) " : ""}${n.title}: ${String(n.body || "").slice(0, 1200)}`;
      if (used + line.length > budget * 0.5) break;
      noteLines.push(line);
      used += line.length;
    }
    if (noteLines.length) lines.push("Notes:\n" + noteLines.join("\n"));

    const files = all.filter(i => i.kind === "file").sort((a, b) => score(b) - score(a));
    if (files.length) {
      lines.push("Files: " + files.map(f => f.title + (f.body ? "" : " (no text)")).join(", "));
      for (const f of files) {
        const room = budget - used - 200;
        if (room < 400) break;
        const content = String(f.body || "").slice(0, Math.min(room, 7000));
        if (!content) continue;
        lines.push(`FILE "${f.title}"${content.length < (f.body || "").length ? " (start of file)" : ""}:\n${content}`);
        used += content.length + f.title.length + 30;
      }
    }

    return { name: ws.name, role: mine.role, text: lines.join("\n\n").slice(0, budget + 2000) };
  } catch (error) {
    console.warn("[WORKSPACE] context failed", error?.message || error);
    return null;
  }
}

/**
 * RLS check (SPEC.md Phase 1 criterion).
 *
 * Exercises the Row Level Security policies from migration 0001 with three
 * lenses — anonymous, authenticated, and service-role — asserting that the
 * public world map is readable by everyone while writes are auth-gated and
 * self-scoped. Exits non-zero if any policy behaves unexpectedly.
 *
 * Run:  pnpm rls-check   (loads .env.local via --env-file)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run via `pnpm rls-check` (uses --env-file=.env.local)."
  );
  process.exit(1);
}

let passed = 0;
let failed = 0;

function ok(desc: string) {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${desc}`);
}
function bad(desc: string, detail?: unknown) {
  failed++;
  console.log(`  \x1b[31m✗\x1b[0m ${desc}`);
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`);
}

/** Assert a Supabase result errored (write was blocked by RLS). */
function expectBlocked(
  desc: string,
  res: { error: unknown | null; status?: number }
) {
  if (res.error) ok(`${desc} — blocked`);
  else bad(`${desc} — expected block, but it SUCCEEDED`);
}
/** Assert a Supabase result did not error. */
function expectOk(desc: string, res: { error: { message?: string } | null }) {
  if (!res.error) ok(desc);
  else bad(desc, res.error.message ?? res.error);
}

const anon = createClient(URL, ANON);
const service = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CLEANUP: { userIds: string[]; placeIds: string[] } = {
  userIds: [],
  placeIds: [],
};

async function makeUser(): Promise<{ client: SupabaseClient; id: string }> {
  const email = `rlscheck+${crypto.randomUUID()}@example.com`;
  const password = crypto.randomUUID();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  CLEANUP.userIds.push(data.user.id);

  const client = createClient(URL!, ANON!);
  const { error: signInErr } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`);
  return { client, id: data.user.id };
}

async function main() {
  console.log("\nRLS check against", URL, "\n");

  // -- Anonymous -----------------------------------------------------------
  console.log("Anonymous (public world map is readable, writes blocked):");
  for (const t of ["places", "place_ancestry", "chats", "messages", "profiles"]) {
    const res = await anon.from(t).select("*").limit(1);
    expectOk(`anon can read ${t}`, res);
  }
  expectBlocked(
    "anon insert into places",
    await anon.from("places").insert({
      kind: "custom",
      name: "anon pin",
      centroid: "POINT(0 0)",
    })
  );
  expectBlocked(
    "anon insert into messages",
    await anon.from("messages").insert({
      chat_id: crypto.randomUUID(),
      author_id: crypto.randomUUID(),
      body: "hi",
    })
  );
  expectBlocked(
    "anon insert into profiles",
    await anon.from("profiles").insert({ id: crypto.randomUUID(), handle: "anon_x" })
  );

  // -- Authenticated (user A) ---------------------------------------------
  console.log("\nAuthenticated user A (self-scoped writes):");
  const a = await makeUser();
  const b = await makeUser();

  // profile: own id ok, other id blocked
  expectOk(
    "A creates own profile",
    await a.client.from("profiles").insert({ id: a.id, handle: `u${a.id.slice(0, 8)}` })
  );
  expectBlocked(
    "A creates a profile for someone else",
    await a.client.from("profiles").insert({ id: b.id, handle: `u${b.id.slice(0, 8)}` })
  );

  // places: custom + self ok; wrong created_by blocked; non-custom kind blocked
  const insSelf = await a.client
    .from("places")
    .insert({ kind: "custom", name: "A's pin", centroid: "POINT(-118.5 34.0)", created_by: a.id })
    .select("id")
    .single();
  expectOk("A inserts a custom place as self", insSelf);
  if (insSelf.data?.id) CLEANUP.placeIds.push(insSelf.data.id);

  expectBlocked(
    "A inserts a place with created_by = someone else",
    await a.client
      .from("places")
      .insert({ kind: "custom", name: "spoof", centroid: "POINT(0 0)", created_by: b.id })
  );
  expectBlocked(
    "A inserts a non-custom place (kind=city)",
    await a.client
      .from("places")
      .insert({ kind: "city", name: "Fake City", centroid: "POINT(0 0)", created_by: a.id })
  );

  // messages: need a chat. Create place + chat via service role.
  const place = await service
    .from("places")
    .insert({ kind: "custom", name: "chat host", centroid: "POINT(0 0)" })
    .select("id")
    .single();
  if (place.error || !place.data) throw new Error(`service place insert: ${place.error?.message}`);
  CLEANUP.placeIds.push(place.data.id);
  const chat = await service
    .from("chats")
    .insert({ place_id: place.data.id })
    .select("id")
    .single();
  if (chat.error || !chat.data) throw new Error(`service chat insert: ${chat.error?.message}`);
  const chatId = chat.data.id;

  const msgSelf = await a.client
    .from("messages")
    .insert({ chat_id: chatId, author_id: a.id, body: "hello from A" })
    .select("id")
    .single();
  expectOk("A posts a message as self", msgSelf);

  expectBlocked(
    "A posts a message spoofing another author",
    await a.client.from("messages").insert({ chat_id: chatId, author_id: b.id, body: "spoof" })
  );

  // delete-own vs delete-other
  if (msgSelf.data?.id) {
    // B (another user) cannot delete A's message
    const delByB = await b.client.from("messages").delete().eq("id", msgSelf.data.id).select();
    if (!delByB.error && (delByB.data?.length ?? 0) === 0) {
      ok("B cannot delete A's message — no rows affected");
    } else if (delByB.error) {
      ok("B cannot delete A's message — blocked");
    } else {
      bad("B deleted A's message — RLS FAILED");
    }
    // A can delete A's own message
    const delByA = await a.client.from("messages").delete().eq("id", msgSelf.data.id).select();
    if (!delByA.error && (delByA.data?.length ?? 0) === 1) ok("A deletes own message");
    else bad("A could not delete own message", delByA.error?.message ?? delByA.data);
  }

  // chats: no client insert policy — even an authed user is blocked.
  expectBlocked(
    "authed user inserts a chat directly (no policy in v1)",
    await a.client.from("chats").insert({ place_id: place.data.id })
  );
}

async function cleanup() {
  for (const id of CLEANUP.placeIds) await service.from("places").delete().eq("id", id);
  for (const id of CLEANUP.userIds) await service.auth.admin.deleteUser(id);
}

main()
  .catch((e) => {
    console.error("\nFatal:", e instanceof Error ? e.message : e);
    failed++;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup error:", e));
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });

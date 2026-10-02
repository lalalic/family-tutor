export { DiscordGateway } from './gateway.mjs';
const DEFAULT_CLIENT_ID = "1489316184578068755";
const SESSION_TTL_MS = 10 * 60 * 1000;
const PERMISSIONS = "68608";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

function validSession(value) {
  return /^bootstrap-[0-9a-f-]{20,80}$/i.test(String(value || ""));
}

function publicOrigin(request, env) {
  return (env.PUBLIC_ORIGIN || new URL(request.url).origin).replace(/\/$/, "");
}

function completionHtml(ok, message) {
  const safe = String(message).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Family Tutor Discord</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:640px;margin:64px auto;padding:0 24px"><h1>${ok ? "Discord connected" : "Discord setup failed"}</h1><p>${safe}</p><p>You can return to NeoY.</p></body></html>`, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export class SetupSession {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/session/begin") {
      const body = await request.json();
      const now = Date.now();
      const current = await this.state.storage.get("record");
      if (current && current.expiresAt > now && current.completedAt) return json(current);
      const record = {
        kind: "session",
        session: body.session,
        status: "waiting_discord",
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
        completedAt: null,
      };
      await this.state.storage.put("record", record);
      await this.state.storage.setAlarm(record.expiresAt);
      return json(record);
    }
    if (request.method === "POST" && url.pathname === "/session/complete") {
      const body = await request.json();
      const current = await this.state.storage.get("record");
      if (!current || current.kind !== "session" || current.expiresAt < Date.now()) return json({ error: "expired_session" }, 410);
      const record = {
        ...current,
        status: "connected",
        completedAt: Date.now(),
        guildId: body.guildId,
      };
      await this.state.storage.put("record", record);
      return json(record);
    }
    if (request.method === "GET" && url.pathname === "/session/status") {
      const current = await this.state.storage.get("record");
      if (!current || current.kind !== "session" || current.expiresAt < Date.now()) return json({ error: "expired_session" }, 410);
      return json(current);
    }
    if (request.method === "POST" && url.pathname === "/state/begin") {
      const body = await request.json();
      const record = {
        kind: "oauth-state",
        session: body.session,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS,
        consumedAt: null,
      };
      await this.state.storage.put("record", record);
      await this.state.storage.setAlarm(record.expiresAt);
      return json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/state/consume") {
      const current = await this.state.storage.get("record");
      if (!current || current.kind !== "oauth-state" || current.expiresAt < Date.now() || current.consumedAt) {
        return json({ error: "invalid_or_expired_state" }, 410);
      }
      current.consumedAt = Date.now();
      await this.state.storage.put("record", current);
      return json({ session: current.session });
    }
    return json({ error: "not_found" }, 404);
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}

function sessionStub(env, session) {
  return env.SESSIONS.get(env.SESSIONS.idFromName(`session:${session}`));
}

function stateStub(env, state) {
  return env.SESSIONS.get(env.SESSIONS.idFromName(`oauth:${state}`));
}

export default {
  async scheduled(_event, env, ctx) {
    if (!env.DISCORD_GATEWAY || !env.DISCORD_BOT_TOKEN || !env.NEOY_MCP_TOKEN) return;
    const stub = env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("poller-v1"));
    ctx.waitUntil(stub.fetch("https://gateway/poll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true, windowMs: 5 * 60 * 1000 }) }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = publicOrigin(request, env);

    if (request.method === "GET" && url.pathname === "/health") {
      let gateway = null;
      if (env.DISCORD_GATEWAY && env.DISCORD_BOT_TOKEN && env.NEOY_MCP_TOKEN) {
        const stub = env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("poller-v1"));
        const poll = await stub.fetch("https://gateway/poll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: false }) });
        gateway = await poll.json();
      }
      return json({ ok: true, service: "family-tutor-discord", gateway });
    }

    if (request.method === "GET" && url.pathname === "/connect") {
      const session = url.searchParams.get("session") || "";
      if (!validSession(session)) return completionHtml(false, "Invalid or missing setup session.");

      await sessionStub(env, session).fetch(new Request("https://session/session/begin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session }),
      }));

      const state = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
      await stateStub(env, state).fetch(new Request("https://state/state/begin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session }),
      }));

      const target = new URL("https://discord.com/oauth2/authorize");
      target.searchParams.set("client_id", env.DISCORD_CLIENT_ID || DEFAULT_CLIENT_ID);
      target.searchParams.set("response_type", "code");
      target.searchParams.set("redirect_uri", env.DISCORD_REDIRECT_URI || `${origin}/discord/callback`);
      target.searchParams.set("scope", "identify bot applications.commands");
      target.searchParams.set("permissions", PERMISSIONS);
      target.searchParams.set("state", state);
      return Response.redirect(target.toString(), 302);
    }

    if (request.method === "GET" && url.pathname === "/discord/callback") {
      const state = url.searchParams.get("state") || "";
      if (!state) return completionHtml(false, "The setup session expired. Start again from NeoY.");

      const consumed = await stateStub(env, state).fetch(new Request("https://state/state/consume", { method: "POST" }));
      if (!consumed.ok) return completionHtml(false, "The setup session expired. Start again from NeoY.");
      const { session } = await consumed.json();

      if (url.searchParams.get("error")) return completionHtml(false, `Discord authorization was cancelled: ${url.searchParams.get("error")}`);
      const code = url.searchParams.get("code") || "";
      const guildId = url.searchParams.get("guild_id") || "";
      if (!code || !guildId) return completionHtml(false, "Discord did not return the installed server.");

      const completed = await sessionStub(env, session).fetch(new Request("https://session/session/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guildId }),
      }));
      if (!completed.ok) return completionHtml(false, "The setup session expired. Start again from NeoY.");
      return completionHtml(true, "The Family Tutor bot was connected. NeoY will continue setup automatically.");
    }

    const internalSessionMatch = url.pathname.match(/^\/v1\/internal\/sessions\/([^/]+)$/);
    if (request.method === "GET" && internalSessionMatch) {
      const session = decodeURIComponent(internalSessionMatch[1]);
      if (!validSession(session)) return json({ error: "invalid_session" }, 400);
      const response = await sessionStub(env, session).fetch(new Request("https://session/session/status"));
      const payload = await response.json();
      if (!response.ok) return json(payload, response.status);
      return json({
        session: payload.session,
        status: payload.status,
        discord_connected: payload.status === "connected",
        guild_id: payload.status === "connected" ? payload.guildId : null,
      });
    }

    const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
    if (request.method === "GET" && sessionMatch) {
      const session = decodeURIComponent(sessionMatch[1]);
      if (!validSession(session)) return json({ error: "invalid_session" }, 400);
      const response = await sessionStub(env, session).fetch(new Request("https://session/session/status"));
      const payload = await response.json();
      if (!response.ok) return json(payload, response.status);

      // The public status intentionally exposes no raw Discord guild/channel IDs.
      return json({
        session: payload.session,
        status: payload.status,
        expires_at: payload.expiresAt,
        completed_at: payload.completedAt,
        discord_connected: payload.status === "connected",
      });
    }

    return json({ error: "not_found" }, 404);
  },
};

export const __test = { validSession };

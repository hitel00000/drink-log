import { moldApp } from "../_shared/generated/mold_app";
import {
  createOAuthStateCookie,
  clearOAuthStateCookie,
  createSessionCookie,
  revokeSession,
  clearSessionCookies,
  getDatabase,
  getImagesBucket,
  getOAuthState,
  getSessionCookie,
  readSession,
  redirect,
  validateAuthEnv,
  type AppEnv,
} from "../_shared/auth";

export async function handleGoogleLogin(request: Request, env: AppEnv) {
  const envError = validateAuthEnv(env);
  if (envError) {
    return envError;
  }

  const state = crypto.randomUUID();
  const redirectUri = env.GOOGLE_REDIRECT_URI ?? new URL("/api/auth/google-callback", request.url).toString();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  const response = redirect(authUrl.toString());
  response.headers.append("Set-Cookie", createOAuthStateCookie(state));
  return response;
}

export async function handleGoogleCallback(request: Request, env: AppEnv) {
  const envError = validateAuthEnv(env);
  if (envError) {
    return envError;
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = getOAuthState(request);

  if (!code || !state || !storedState || state !== storedState) {
    return new Response("Invalid OAuth state.", { status: 400 });
  }

  const redirectUri = env.GOOGLE_REDIRECT_URI ?? new URL("/api/auth/google-callback", request.url).toString();
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !tokenData.access_token) {
    return new Response(tokenData.error ?? "Could not exchange OAuth code.", { status: 400 });
  }

  const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userInfoResponse.ok) {
    return new Response("Could not load Google user profile.", { status: 400 });
  }

  const profile = (await userInfoResponse.json()) as {
    sub: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  const now = new Date().toISOString();
  const userId = `google:${profile.sub}`;

  await getDatabase(env)
    .prepare(
      `INSERT INTO users (
        id,
        provider,
        provider_user_id,
        email,
        display_name,
        avatar_url,
        created_at,
        last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_user_id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        last_login_at = excluded.last_login_at`,
    )
    .bind(
      userId,
      "google",
      profile.sub,
      profile.email ?? null,
      profile.name ?? null,
      profile.picture ?? null,
      now,
      now,
    )
    .run();

  const response = redirect("/#/logs");
  response.headers.append("Set-Cookie", clearOAuthStateCookie());
  response.headers.append("Set-Cookie", await createSessionCookie(env, userId));
  return response;
}

export async function handleLogout(request: Request, env: AppEnv) {
  await revokeSession(request, env);

  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo");

  let response: Response;
  if (returnTo) {
    response = redirect(returnTo);
  } else {
    response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
    });
  }

  clearSessionCookies().forEach((cookie) => response.headers.append("Set-Cookie", cookie));
  return response;
}

export async function handleMe(request: Request, env: AppEnv) {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };

  const session = await readSession(request, env);
  if (!session) {
    return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers });
  }

  const user = await getDatabase(env)
    .prepare("SELECT id, email, display_name, avatar_url FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ id: string; email: string | null; display_name: string | null; avatar_url: string | null }>();

  if (!user) {
    return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers });
  }

  return new Response(
    JSON.stringify({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    }),
    { status: 200, headers },
  );
}

export async function handleImages(request: Request, env: AppEnv) {
  const session = await readSession(request, env);
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return new Response("Missing key", { status: 400 });
  }

  const image = await getDatabase(env)
    .prepare(
      `SELECT owner_id, mime_type FROM sake_images
       WHERE image_key = ? OR thumbnail_key = ?`,
    )
    .bind(key, key)
    .first<{ owner_id: string; mime_type: string }>();

  if (!image) {
    return new Response("Not found", { status: 404 });
  }

  if (image.owner_id !== session.userId) {
    return new Response("Forbidden", { status: 403 });
  }

  const object = await getImagesBucket(env).get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? image.mime_type,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

async function prepareMoldRequest(request: Request, env: AppEnv): Promise<Request> {
  const sessionId = getSessionCookie(request);
  if (!sessionId) {
    return request;
  }

  const cookieHeader = request.headers.get("Cookie") || "";
  if (cookieHeader.includes("mold_session=")) {
    return request;
  }

  const session = await readSession(request, env);
  if (!session) {
    return request;
  }

  try {
    const db = getDatabase(env);
    await db
      .prepare(
        'INSERT INTO "_mold_sessions" (id, user_id, expires_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, expires_at = excluded.expires_at',
      )
      .bind(sessionId, session.userId, new Date(session.exp * 1000).toISOString())
      .run();
  } catch (e) {
    // best-effort mold bridge
  }

  const moldCookie = `mold_session=${sessionId}`;
  const newCookie = cookieHeader ? `${cookieHeader}; ${moldCookie}` : moldCookie;
  const newHeaders = new Headers(request.headers);
  newHeaders.set("Cookie", newCookie);

  return new Request(request, { headers: newHeaders });
}

export const onRequest: PagesFunction<AppEnv> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/api/auth/google/login" || pathname === "/api/auth/google/login/") {
    return handleGoogleLogin(request, env);
  }
  if (pathname === "/api/auth/google-callback" || pathname === "/api/auth/google/callback") {
    return handleGoogleCallback(request, env);
  }
  if (pathname === "/api/auth/logout") {
    return handleLogout(request, env);
  }
  if (pathname === "/api/me") {
    return handleMe(request, env);
  }
  if (pathname === "/api/images") {
    return handleImages(request, env);
  }

  const db = getDatabase(env);
  let bucket: R2Bucket | undefined;
  try {
    bucket = getImagesBucket(env);
  } catch (e) {}

  const mappedEnv = {
    ...env,
    DB: db,
    BUCKET: bucket,
  };

  const moldRequest = await prepareMoldRequest(request, env);
  return moldApp.fetch(moldRequest, mappedEnv, context as unknown as ExecutionContext);
};

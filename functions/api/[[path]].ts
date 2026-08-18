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
  const acceptHeader = request.headers.get("Accept") || "";

  let response: Response;
  if (acceptHeader.includes("application/json") && !returnTo) {
    response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
    });
  } else {
    response = redirect(returnTo || "/");
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

function parseDataUrl(value: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
  if (!match) {
    return null;
  }

  const mimeType = match[1] || "application/octet-stream";
  const payload = match[3];
  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { bytes, mimeType };
  }

  return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mimeType };
}

function extractR2Key(val: string | null | undefined): string | null {
  if (!val || typeof val !== "string") return null;
  if (val.startsWith("/api/images?key=")) {
    return decodeURIComponent(val.replace("/api/images?key=", ""));
  }
  if (val.startsWith("images/") || val.startsWith("thumbnails/") || val.startsWith("blobs/")) {
    return val;
  }
  return null;
}

export async function handleSakeImagesCreate(request: Request, env: AppEnv) {
  const session = await readSession(request, env);
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const recordId = Number(body.record_id);
  if (isNaN(recordId)) {
    return new Response(JSON.stringify({ error: "record_id must be a number" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const mimeType = typeof body.mime_type === "string" ? body.mime_type.trim() : "image/jpeg";
  const fileName = typeof body.file_name === "string" ? body.file_name.trim() : "photo.jpg";
  const displayOrder = typeof body.display_order === "number" ? body.display_order : 0;
  const imageId = crypto.randomUUID();
  const ext = fileName.includes(".") ? fileName.substring(fileName.lastIndexOf(".")) : ".jpg";

  const bucket = getImagesBucket(env);

  // Check if this is an existing image key or a new base64 data upload
  const existingImageKey = extractR2Key(body.image_key);
  const existingThumbKey = extractR2Key(body.thumbnail_key);

  let imageKey = existingImageKey ?? `images/${session.userId}/sake/${recordId}/${imageId}${ext}`;
  let thumbnailKey = existingThumbKey ?? `thumbnails/${session.userId}/sake/${recordId}/${imageId}.webp`;

  // 1. Upload original to R2 if provided as Data URL
  if (typeof body.image_key === "string" && body.image_key.startsWith("data:")) {
    const orig = parseDataUrl(body.image_key);
    if (orig) {
      imageKey = `images/${session.userId}/sake/${recordId}/${imageId}${ext}`;
      await bucket.put(imageKey, orig.bytes, {
        httpMetadata: { contentType: mimeType || orig.mimeType },
      });
    }
  }

  // 2. Upload thumbnail to R2 if provided as Data URL
  if (typeof body.thumbnail_key === "string" && body.thumbnail_key.startsWith("data:")) {
    const thumb = parseDataUrl(body.thumbnail_key);
    if (thumb) {
      thumbnailKey = `thumbnails/${session.userId}/sake/${recordId}/${imageId}.webp`;
      await bucket.put(thumbnailKey, thumb.bytes, {
        httpMetadata: { contentType: "image/webp" },
      });
    }
  }

  // 3. Insert metadata into D1
  const now = new Date().toISOString();
  const created = await getDatabase(env)
    .prepare(
      `INSERT INTO sake_images (owner_id, record_id, image_key, thumbnail_key, mime_type, file_name, display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(session.userId, recordId, imageKey, thumbnailKey, mimeType, fileName, displayOrder, now, now)
    .first();

  return new Response(JSON.stringify({ data: created }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
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

export async function handleEntriesGet(request: Request, env: AppEnv) {
  const session = await readSession(request, env);
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = getDatabase(env);
  const [recordsRes, imagesRes, recordTagsRes, tagsRes] = await db.batch([
    db.prepare(
      `SELECT * FROM sake_records WHERE owner_id = ? AND drink_type = 'sake' ORDER BY consumed_date DESC, created_at DESC`,
    ).bind(session.userId),
    db.prepare(
      `SELECT * FROM sake_images WHERE owner_id = ? ORDER BY display_order ASC, created_at ASC`,
    ).bind(session.userId),
    db.prepare(`SELECT * FROM record_tags`),
    db.prepare(
      `SELECT * FROM tags WHERE drink_type = 'sake' AND (owner_id IS NULL OR owner_id = ?) ORDER BY tag_group ASC, is_default DESC, label ASC`,
    ).bind(session.userId),
  ]);

  const records = (recordsRes.results || []) as any[];
  const images = (imagesRes.results || []) as any[];
  const recordTags = (recordTagsRes.results || []) as any[];
  const tags = (tagsRes.results || []) as any[];

  const tagsById = new Map<string, any>(tags.map((t) => [String(t.id), t]));

  const imagesByRecordId = new Map<string, any[]>();
  for (const img of images) {
    const k = String(img.record_id);
    const list = imagesByRecordId.get(k) ?? [];
    list.push({
      ...img,
      data_url: img.image_key ? `/api/images?key=${encodeURIComponent(img.image_key)}` : null,
      thumbnail_data_url: img.thumbnail_key ? `/api/images?key=${encodeURIComponent(img.thumbnail_key)}` : null,
    });
    imagesByRecordId.set(k, list);
  }

  const recordTagsByRecordId = new Map<string, any[]>();
  for (const rt of recordTags) {
    const k = String(rt.sake_record_id ?? rt.record_id);
    const list = recordTagsByRecordId.get(k) ?? [];
    list.push(rt);
    recordTagsByRecordId.set(k, list);
  }

  const entries = records.map((record) => {
    const recId = String(record.id);
    const recImages = imagesByRecordId.get(recId) ?? [];
    const recTagsList = recordTagsByRecordId.get(recId) ?? [];
    const recTags = recTagsList
      .map((rt) => tagsById.get(String(rt.tag_id)))
      .filter(Boolean)
      .map((t) => ({ ...t, is_default: Boolean(t.is_default) }));

    return {
      id: record.id,
      record,
      images: recImages,
      tags: recTags,
      record_tags: recTagsList,
    };
  });

  return new Response(JSON.stringify({ data: entries }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function handleEntriesCreate(request: Request, env: AppEnv) {
  const session = await readSession(request, env);
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let draft: any;
  try {
    draft = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const name = typeof draft.name === "string" ? draft.name.trim() : "";
  if (!name) {
    return new Response(JSON.stringify({ error: "name is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = getDatabase(env);
  const bucket = getImagesBucket(env);
  const now = new Date().toISOString();
  const uploadedR2Keys: string[] = [];

  // 1. Process and upload images to R2
  const processedImages: any[] = [];
  const rawImages = Array.isArray(draft.images) ? draft.images : [];
  for (let i = 0; i < rawImages.length; i++) {
    const img = rawImages[i];
    const imageId = crypto.randomUUID();
    const fileName = typeof img.file_name === "string" ? img.file_name.trim() : `photo_${i + 1}.jpg`;
    const mimeType = typeof img.mime_type === "string" ? img.mime_type.trim() : "image/jpeg";
    const ext = fileName.includes(".") ? fileName.substring(fileName.lastIndexOf(".")) : ".jpg";
    const displayOrder = typeof img.display_order === "number" ? img.display_order : i;

    let imageKey = extractR2Key(img.data_url || img.image_key);
    let thumbnailKey = extractR2Key(img.thumbnail_data_url || img.thumbnail_key);

    const dataUrl = img.data_url || img.image_key;
    if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
      const parsed = parseDataUrl(dataUrl);
      if (parsed) {
        imageKey = `images/${session.userId}/sake/temp/${imageId}${ext}`;
        try {
          await bucket.put(imageKey, parsed.bytes, {
            httpMetadata: { contentType: mimeType || parsed.mimeType },
          });
          uploadedR2Keys.push(imageKey);
        } catch (err) {
          console.error("Failed to put image to R2:", err);
        }
      }
    }

    const thumbUrl = img.thumbnail_data_url || img.thumbnail_key;
    if (typeof thumbUrl === "string" && thumbUrl.startsWith("data:")) {
      const parsedThumb = parseDataUrl(thumbUrl);
      if (parsedThumb) {
        thumbnailKey = `thumbnails/${session.userId}/sake/temp/${imageId}.webp`;
        try {
          await bucket.put(thumbnailKey, parsedThumb.bytes, {
            httpMetadata: { contentType: "image/webp" },
          });
          uploadedR2Keys.push(thumbnailKey);
        } catch (err) {
          console.error("Failed to put thumbnail to R2:", err);
        }
      }
    }

    processedImages.push({
      imageKey,
      thumbnailKey,
      fileName,
      mimeType,
      displayOrder,
    });
  }

  // 2. Insert parent sake_record
  let createdRecord: any = null;
  try {
    createdRecord = await db
      .prepare(
        `INSERT INTO sake_records (
          owner_id, drink_type, name, region, brewery, rice, sake_type, sake_meter_value,
          abv, volume, price, drink_again, sweet_dry, aroma_intensity, acidity, clean_umami,
          one_line_note, place, consumed_date, companions, food_pairing, created_at, updated_at
        ) VALUES (?, 'sake', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(
        session.userId,
        name,
        typeof draft.region === "string" ? draft.region.trim() || null : null,
        typeof draft.brewery === "string" ? draft.brewery.trim() || null : null,
        typeof draft.rice === "string" ? draft.rice.trim() || null : null,
        typeof draft.sake_type === "string" ? draft.sake_type.trim() || null : null,
        typeof draft.sake_meter_value === "string" ? draft.sake_meter_value.trim() || null : null,
        typeof draft.abv === "string" ? draft.abv.trim() || null : null,
        typeof draft.volume === "string" ? draft.volume.trim() || null : null,
        typeof draft.price === "string" ? draft.price.trim() || null : null,
        draft.drink_again || null,
        typeof draft.sweet_dry === "number" ? draft.sweet_dry : null,
        typeof draft.aroma_intensity === "number" ? draft.aroma_intensity : null,
        typeof draft.acidity === "number" ? draft.acidity : null,
        typeof draft.clean_umami === "number" ? draft.clean_umami : null,
        typeof draft.one_line_note === "string" ? draft.one_line_note.trim() || null : null,
        typeof draft.place === "string" ? draft.place.trim() || null : null,
        draft.consumed_date || now.split("T")[0],
        typeof draft.companions === "string" ? draft.companions.trim() || null : null,
        typeof draft.food_pairing === "string" ? draft.food_pairing.trim() || null : null,
        now,
        now,
      )
      .first();
  } catch (err: any) {
    await Promise.all(uploadedR2Keys.map((k) => bucket.delete(k).catch(() => {})));
    return new Response(JSON.stringify({ error: "Failed to insert record: " + (err.message || err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const recordId = createdRecord.id;

  // 3. Batch insert child sake_images and record_tags
  const batchStatements: any[] = [];

  for (const img of processedImages) {
    batchStatements.push(
      db
        .prepare(
          `INSERT INTO sake_images (owner_id, record_id, image_key, thumbnail_key, mime_type, file_name, display_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          session.userId,
          recordId,
          img.imageKey,
          img.thumbnailKey,
          img.mimeType,
          img.fileName,
          img.displayOrder,
          now,
          now,
        ),
    );
  }

  const selectedTagIds = Array.isArray(draft.selected_tag_ids) ? draft.selected_tag_ids : [];
  for (const tagId of selectedTagIds) {
    batchStatements.push(
      db
        .prepare(
          `INSERT INTO record_tags (sake_record_id, tag_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(recordId, String(tagId), now, now),
    );
  }

  if (batchStatements.length > 0) {
    try {
      await db.batch(batchStatements);
    } catch (err: any) {
      await db.prepare(`DELETE FROM sake_records WHERE id = ?`).bind(recordId).run().catch(() => {});
      await Promise.all(uploadedR2Keys.map((k) => bucket.delete(k).catch(() => {})));
      return new Response(JSON.stringify({ error: "Failed to insert child entities: " + (err.message || err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 4. Fetch tag metadata to build and return complete SakeRecordEntry
  const allTagsRes = await db
    .prepare(`SELECT * FROM tags WHERE drink_type = 'sake' AND (owner_id IS NULL OR owner_id = ?)`)
    .bind(session.userId)
    .all();
  const allTags = (allTagsRes.results || []) as any[];
  const tagsById = new Map<string, any>(allTags.map((t) => [String(t.id), t]));

  const builtImages = processedImages.map((img, idx) => ({
    id: idx + 1,
    owner_id: session.userId,
    record_id: recordId,
    image_key: img.imageKey,
    thumbnail_key: img.thumbnailKey,
    mime_type: img.mimeType,
    file_name: img.fileName,
    display_order: img.displayOrder,
    data_url: img.imageKey ? `/api/images?key=${encodeURIComponent(img.imageKey)}` : null,
    thumbnail_data_url: img.thumbnailKey ? `/api/images?key=${encodeURIComponent(img.thumbnailKey)}` : null,
    created_at: now,
    updated_at: now,
  }));

  const builtTags = selectedTagIds
    .map((tid: any) => tagsById.get(String(tid)))
    .filter(Boolean)
    .map((t: any) => ({ ...t, is_default: Boolean(t.is_default) }));

  const builtRecordTags = selectedTagIds.map((tid: any) => ({
    sake_record_id: recordId,
    tag_id: String(tid),
    created_at: now,
  }));

  const entry = {
    id: recordId,
    record: createdRecord,
    images: builtImages,
    tags: builtTags,
    record_tags: builtRecordTags,
  };

  return new Response(JSON.stringify({ data: entry }), {
    status: 201,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
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
  if (pathname === "/api/entries" && request.method === "GET") {
    return handleEntriesGet(request, env);
  }
  if (pathname === "/api/entries" && request.method === "POST") {
    return handleEntriesCreate(request, env);
  }
  if (pathname === "/api/sake_images" && request.method === "POST") {
    return handleSakeImagesCreate(request, env);
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


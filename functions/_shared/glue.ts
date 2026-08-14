import moldApp from "./generated/mold_app";
import { readSession, revokeSession, clearSessionCookies, type AppEnv } from "./auth";

function imageUrl(key: string) {
  return `/api/images?key=${encodeURIComponent(key)}`;
}

export function buildEntry(record: any, images: any[], recordTags: any[], tags: any[]) {
  const tagsById = new Map(tags.map((tag: any) => [tag.id, tag]));
  return {
    id: record.id,
    record,
    images: images
      .sort((left, right) => left.display_order - right.display_order)
      .map((image: any) => ({
        ...image,
        data_url: imageUrl(image.image_key),
        thumbnail_data_url: image.thumbnail_key ? imageUrl(image.thumbnail_key) : null,
      })),
    record_tags: recordTags,
    tags: recordTags
      .map((recordTag: any) => tagsById.get(recordTag.tag_id))
      .filter((tag: any) => Boolean(tag))
      .map((tag: any) => ({ ...tag, is_default: Boolean(tag.is_default) })),
  };
}

export function getMappedEnv(env: AppEnv) {
  const db = env.DB ?? env.alcohol_log;
  const bucket = env.IMAGES ?? env.alcohol_log_images;
  return {
    ...env,
    DB: db,
    BUCKET: bucket,
  };
}

export async function authorizeRecordOwner(db: any, sessionUserId: string, recordIdStr: string) {
  const userRow = await db.prepare("SELECT id FROM users WHERE legacy_id = ? OR id = ?").bind(sessionUserId, sessionUserId).first<{ id: number }>();
  if (!userRow) return { error: "unauthorized", status: 401, userIntId: null, recordRow: null };

  const recordRow = await db.prepare("SELECT id, legacy_id, owner_id FROM sake_records WHERE legacy_id = ? OR id = ?").bind(recordIdStr, recordIdStr).first<{ id: number; legacy_id: string; owner_id: number }>();
  if (!recordRow) return { error: "not_found", status: 404, userIntId: userRow.id, recordRow: null };

  if (recordRow.owner_id !== userRow.id) {
    return { error: "forbidden", status: 403, userIntId: userRow.id, recordRow };
  }

  return { error: null, status: 200, userIntId: userRow.id, recordRow };
}

export async function fetchSakeRecordsEntry(request: Request, env: AppEnv, ctx?: any) {
  const mappedEnv = getMappedEnv(env);
  const db = mappedEnv.DB;
  if (!db) throw new Error("D1 database binding missing");

  const session = await readSession(request, mappedEnv);
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const reqRecords = new Request("http://localhost/api/sake_records?limit=100", { headers: request.headers });
  const resRecords = await moldApp.fetch(reqRecords, mappedEnv, ctx);
  if (resRecords.status !== 200) return resRecords;

  const recordsData = (await resRecords.json()) as { data?: any[] };
  const records = recordsData.data || [];

  const userRow = await db.prepare("SELECT id FROM users WHERE legacy_id = ? OR id = ?").bind(session.userId, session.userId).first<{ id: number }>();
  const currentOwnerId = userRow ? userRow.id : null;
  const userRecords = currentOwnerId ? records.filter((r: any) => r.owner_id === currentOwnerId) : [];

  const resImages = await moldApp.fetch(new Request("http://localhost/api/sake_images?limit=100", { headers: request.headers }), mappedEnv, ctx);
  const resTags = await moldApp.fetch(new Request("http://localhost/api/tags?limit=100", { headers: request.headers }), mappedEnv, ctx);

  const rawImages = ((await resImages.json()) as { data?: any[] }).data || [];
  const rawTags = ((await resTags.json()) as { data?: any[] }).data || [];

  const recordIds = userRecords.map((r: any) => r.id);
  let rawRecordTags: any[] = [];
  if (recordIds.length > 0) {
    const placeholders = recordIds.map(() => "?").join(",");
    const stmt = await db
      .prepare(`SELECT sake_record_id, tag_id, created_at FROM record_tags WHERE sake_record_id IN (${placeholders})`)
      .bind(...recordIds)
      .all<any>();
    rawRecordTags = stmt.results || [];
  }

  const ownerIds = Array.from(
    new Set([
      ...userRecords.map((r: any) => r.owner_id),
      ...rawImages.map((i: any) => i.owner_id),
      ...rawTags.map((t: any) => t.owner_id).filter(Boolean),
    ]),
  );

  const userMap = new Map<number, string>();
  if (ownerIds.length > 0) {
    const userPlaceholders = ownerIds.map(() => "?").join(",");
    const userStmt = await db
      .prepare(`SELECT id, legacy_id FROM users WHERE id IN (${userPlaceholders})`)
      .bind(...ownerIds)
      .all<any>();
    for (const u of userStmt.results || []) {
      userMap.set(u.id, u.legacy_id);
    }
  }

  const sakeMap = new Map<number, string>(userRecords.map((r: any) => [r.id, r.legacy_id || String(r.id)]));
  const tagMap = new Map<number, string>(rawTags.map((t: any) => [t.id, t.legacy_id || String(t.id)]));

  const remappedRecords = userRecords.map((r: any) => {
    const copy = {
      ...r,
      id: r.legacy_id || String(r.id),
      owner_id: userMap.get(r.owner_id) || String(r.owner_id),
    };
    delete copy.legacy_id;
    return copy;
  });

  const remappedImages = rawImages.map((i: any) => {
    const copy = {
      ...i,
      id: i.legacy_id || String(i.id),
      owner_id: userMap.get(i.owner_id) || String(i.owner_id),
      record_id: sakeMap.get(i.record_id) || String(i.record_id),
    };
    delete copy.legacy_id;
    delete copy.updated_at;
    return copy;
  });

  const remappedTags = rawTags.map((t: any) => {
    const copy = {
      ...t,
      id: t.legacy_id || String(t.id),
      owner_id: t.owner_id ? userMap.get(t.owner_id) || String(t.owner_id) : null,
    };
    delete copy.legacy_id;
    delete copy.updated_at;
    return copy;
  });

  const remappedRecordTags = rawRecordTags.map((rt: any) => ({
    sake_record_id: sakeMap.get(rt.sake_record_id) || String(rt.sake_record_id),
    record_id: sakeMap.get(rt.sake_record_id) || String(rt.sake_record_id),
    tag_id: tagMap.get(rt.tag_id) || String(rt.tag_id),
    created_at: rt.created_at,
  }));

  const imagesByRecordId = new Map<string, any[]>();
  for (const img of remappedImages) {
    const list = imagesByRecordId.get(img.record_id) || [];
    list.push(img);
    imagesByRecordId.set(img.record_id, list);
  }

  const tagsByRecordId = new Map<string, any[]>();
  for (const rt of remappedRecordTags) {
    const recordKey = rt.sake_record_id;
    const list = tagsByRecordId.get(recordKey) || [];
    list.push(rt);
    tagsByRecordId.set(recordKey, list);
  }

  const entries = remappedRecords.map((rec: any) =>
    buildEntry(
      rec,
      imagesByRecordId.get(rec.id) || [],
      tagsByRecordId.get(rec.id) || [],
      remappedTags,
    ),
  );

  return new Response(JSON.stringify(entries), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function fetchSingleSakeRecordEntry(request: Request, env: AppEnv, recordId: string, ctx?: any) {
  const mappedEnv = getMappedEnv(env);
  const db = mappedEnv.DB;
  if (!db) throw new Error("D1 database binding missing");

  const session = await readSession(request, mappedEnv);
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const authResult = await authorizeRecordOwner(db, session.userId, recordId);
  if (authResult.error) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const allEntriesRes = await fetchSakeRecordsEntry(request, env, ctx);
  if (allEntriesRes.status !== 200) return allEntriesRes;

  const entries = (await allEntriesRes.json()) as any[];
  const single = entries.find((e: any) => e.id === authResult.recordRow?.legacy_id || String(e.id) === String(authResult.recordRow?.id));
  if (!single) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  return new Response(JSON.stringify(single), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function createSakeRecordEntry(request: Request, env: AppEnv, ctx?: any) {
  const mappedEnv = getMappedEnv(env);
  const db = mappedEnv.DB;
  if (!db) throw new Error("D1 database binding missing");

  const session = await readSession(request, mappedEnv);
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const userRow = await db.prepare("SELECT id FROM users WHERE legacy_id = ? OR id = ?").bind(session.userId, session.userId).first<{ id: number }>();
  if (!userRow) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const payload = (await request.json()) as any;
  const legacyId = crypto.randomUUID();
  const moldPayload = {
    ...payload,
    legacy_id: legacyId,
    owner_id: userRow.id,
    drink_type: "sake",
  };

  const reqMold = new Request("http://localhost/api/sake_records", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: request.headers.get("Cookie") || "",
    },
    body: JSON.stringify(moldPayload),
  });

  const resMold = await moldApp.fetch(reqMold, mappedEnv, ctx);
  if (resMold.status !== 201) return resMold;

  const moldData = (await resMold.json()) as { data?: any };
  const createdRecord = moldData.data;

  if (Array.isArray(payload.tag_ids) && payload.tag_ids.length > 0 && createdRecord) {
    for (const tagIdStr of payload.tag_ids) {
      const tagRow = await db.prepare("SELECT id FROM tags WHERE legacy_id = ? OR id = ?").bind(tagIdStr, tagIdStr).first<{ id: number }>();
      if (tagRow) {
        await db.prepare("INSERT INTO record_tags (sake_record_id, tag_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
          .bind(createdRecord.id, tagRow.id, new Date().toISOString(), new Date().toISOString())
          .run();
      }
    }
  }

  return fetchSingleSakeRecordEntry(request, env, legacyId, ctx);
}

export async function updateSakeRecordEntry(request: Request, env: AppEnv, recordId: string, ctx?: any) {
  const mappedEnv = getMappedEnv(env);
  const db = mappedEnv.DB;
  if (!db) throw new Error("D1 database binding missing");

  const session = await readSession(request, mappedEnv);
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const authResult = await authorizeRecordOwner(db, session.userId, recordId);
  if (authResult.error) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const recordRow = authResult.recordRow!;
  const payload = (await request.json()) as any;

  const reqMold = new Request(`http://localhost/api/sake_records/${recordRow.id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: request.headers.get("Cookie") || "",
    },
    body: JSON.stringify(payload),
  });

  const resMold = await moldApp.fetch(reqMold, mappedEnv, ctx);
  if (resMold.status !== 200) return resMold;

  if (Array.isArray(payload.tag_ids)) {
    await db.prepare("DELETE FROM record_tags WHERE sake_record_id = ?").bind(recordRow.id).run();
    for (const tagIdStr of payload.tag_ids) {
      const tagRow = await db.prepare("SELECT id FROM tags WHERE legacy_id = ? OR id = ?").bind(tagIdStr, tagIdStr).first<{ id: number }>();
      if (tagRow) {
        await db.prepare("INSERT INTO record_tags (sake_record_id, tag_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
          .bind(recordRow.id, tagRow.id, new Date().toISOString(), new Date().toISOString())
          .run();
      }
    }
  }

  return fetchSingleSakeRecordEntry(request, env, recordId, ctx);
}

export async function deleteSakeRecordEntry(request: Request, env: AppEnv, recordId: string, ctx?: any) {
  const mappedEnv = getMappedEnv(env);
  const db = mappedEnv.DB;
  if (!db) throw new Error("D1 database binding missing");

  const session = await readSession(request, mappedEnv);
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const authResult = await authorizeRecordOwner(db, session.userId, recordId);
  if (authResult.error) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const recordRow = authResult.recordRow!;

  // 1. Delete associated record_tags
  await db.prepare("DELETE FROM record_tags WHERE sake_record_id = ?").bind(recordRow.id).run();

  // 2. Delete record via Mold Sub-App
  const reqMold = new Request(`http://localhost/api/sake_records/${recordRow.id}`, {
    method: "DELETE",
    headers: {
      Cookie: request.headers.get("Cookie") || "",
    },
  });
  const resMold = await moldApp.fetch(reqMold, mappedEnv, ctx);
  if (resMold.status !== 200 && resMold.status !== 204) return resMold;

  return new Response(null, { status: 204 });
}

export async function addSakeRecordImageEntry(request: Request, env: AppEnv, recordId: string, ctx?: any) {
  const mappedEnv = getMappedEnv(env);
  const db = mappedEnv.DB;
  if (!db) throw new Error("D1 database binding missing");

  const session = await readSession(request, mappedEnv);
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const authResult = await authorizeRecordOwner(db, session.userId, recordId);
  if (authResult.error) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const recordRow = authResult.recordRow!;
  const payload = (await request.json()) as any;
  const imageLegacyId = crypto.randomUUID();

  const imageKey = payload.image_key || `images/${authResult.userIntId}/sake/${recordRow.id}/${imageLegacyId}.jpg`;
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO sake_images (legacy_id, owner_id, record_id, image_key, thumbnail_key, mime_type, file_name, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      imageLegacyId,
      authResult.userIntId,
      recordRow.id,
      imageKey,
      payload.thumbnail_key || null,
      payload.mime_type || "image/jpeg",
      payload.file_name || "sake.jpg",
      payload.display_order || 0,
      now,
      now
    )
    .run();

  return new Response(
    JSON.stringify({
      id: imageLegacyId,
      owner_id: session.userId,
      record_id: recordId,
      image_key: imageKey,
      thumbnail_key: payload.thumbnail_key || null,
      mime_type: payload.mime_type || "image/jpeg",
      file_name: payload.file_name || "sake.jpg",
      display_order: payload.display_order || 0,
      created_at: now,
      updated_at: now,
      data_url: imageUrl(imageKey),
      thumbnail_data_url: payload.thumbnail_key ? imageUrl(payload.thumbnail_key) : null,
    }),
    { status: 201, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

export async function deleteSakeRecordImageEntry(request: Request, env: AppEnv, recordId: string, imageId: string, ctx?: any) {
  const mappedEnv = getMappedEnv(env);
  const db = mappedEnv.DB;
  if (!db) throw new Error("D1 database binding missing");

  const session = await readSession(request, mappedEnv);
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const authResult = await authorizeRecordOwner(db, session.userId, recordId);
  if (authResult.error) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const imgRow = await db.prepare("SELECT id, legacy_id, image_key, thumbnail_key FROM sake_images WHERE legacy_id = ? OR id = ?").bind(imageId, imageId).first<{ id: number; legacy_id: string; image_key: string; thumbnail_key: string | null }>();
  if (!imgRow) {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const reqMold = new Request(`http://localhost/api/sake_images/${imgRow.id}`, {
    method: "DELETE",
    headers: { Cookie: request.headers.get("Cookie") || "" },
  });

  const resMold = await moldApp.fetch(reqMold, mappedEnv, ctx);
  if (resMold.status !== 200 && resMold.status !== 204) return resMold;

  const bucket = mappedEnv.BUCKET;
  if (bucket) {
    await Promise.all([imgRow.image_key, imgRow.thumbnail_key].filter(Boolean).map((k) => bucket.delete(String(k))));
  }

  return new Response(null, { status: 204 });
}

export async function deleteTagEntry(request: Request, env: AppEnv, tagId: string, ctx?: any) {
  const mappedEnv = getMappedEnv(env);
  const db = mappedEnv.DB;
  if (!db) throw new Error("D1 database binding missing");

  const session = await readSession(request, mappedEnv);
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const userRow = await db.prepare("SELECT id FROM users WHERE legacy_id = ? OR id = ?").bind(session.userId, session.userId).first<{ id: number }>();
  if (!userRow) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json; charset=utf-8" } });

  const tagRow = await db.prepare("SELECT id, owner_id, is_default FROM tags WHERE legacy_id = ? OR id = ?").bind(tagId, tagId).first<{ id: number; owner_id: number | null; is_default: number }>();
  if (!tagRow) {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  if (Boolean(tagRow.is_default) || tagRow.owner_id === null || tagRow.owner_id !== userRow.id) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  await db.prepare("DELETE FROM record_tags WHERE tag_id = ?").bind(tagRow.id).run();

  const reqMold = new Request(`http://localhost/api/tags/${tagRow.id}`, {
    method: "DELETE",
    headers: { Cookie: request.headers.get("Cookie") || "" },
  });
  const resMold = await moldApp.fetch(reqMold, mappedEnv, ctx);
  if (resMold.status !== 200 && resMold.status !== 204) return resMold;

  return new Response(null, { status: 204 });
}

export async function searchSakeRecordsEntry(request: Request, env: AppEnv, ctx?: any) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const allRes = await fetchSakeRecordsEntry(request, env, ctx);
  if (allRes.status !== 200) return allRes;

  const entries = (await allRes.json()) as any[];
  if (!query) return new Response(JSON.stringify(entries), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });

  const search = query.toLowerCase();
  const filtered = entries.filter((e: any) => {
    const rec = e.record || {};
    const tagMatch = (e.tags || []).some((t: any) => t.label && t.label.toLowerCase().includes(search));
    return (
      (rec.name && rec.name.toLowerCase().includes(search)) ||
      (rec.region && rec.region.toLowerCase().includes(search)) ||
      (rec.brewery && rec.brewery.toLowerCase().includes(search)) ||
      (rec.sake_type && rec.sake_type.toLowerCase().includes(search)) ||
      (rec.rice && rec.rice.toLowerCase().includes(search)) ||
      (rec.place && rec.place.toLowerCase().includes(search)) ||
      (rec.one_line_note && rec.one_line_note.toLowerCase().includes(search)) ||
      tagMatch
    );
  });

  return new Response(JSON.stringify(filtered), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export async function handleMe(request: Request, env: AppEnv) {
  const mappedEnv = getMappedEnv(env);
  const db = mappedEnv.DB;
  if (!db) throw new Error("D1 database binding missing");

  const session = await readSession(request, mappedEnv);
  if (!session) {
    return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } });
  }

  const user = await db.prepare("SELECT id, legacy_id, email, display_name, avatar_url FROM users WHERE legacy_id = ? OR id = ?").bind(session.userId, session.userId).first<{ id: number; legacy_id: string; email: string | null; display_name: string | null; avatar_url: string | null }>();
  if (!user) {
    return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } });
  }

  return new Response(
    JSON.stringify({
      authenticated: true,
      user: {
        id: user.legacy_id || String(user.id),
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    }),
    { status: 200, headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } },
  );
}

export async function handleLogout(request: Request, env: AppEnv) {
  const mappedEnv = getMappedEnv(env);
  await revokeSession(request, mappedEnv);

  const response = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
  });

  clearSessionCookies().forEach((cookie) => response.headers.append("Set-Cookie", cookie));
  return response;
}

export { moldApp };

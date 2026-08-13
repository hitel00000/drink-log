import moldApp from "./generated/mold_app";
import { buildEntry } from "./sake";
import type { AppEnv } from "./auth";

export function getMappedEnv(env: AppEnv) {
  const db = env.DB ?? env.alcohol_log;
  const bucket = env.IMAGES ?? env.alcohol_log_images;
  return {
    ...env,
    DB: db,
    BUCKET: bucket,
  };
}

export async function fetchSakeRecordsEntry(request: Request, env: AppEnv, ctx?: any) {
  const mappedEnv = getMappedEnv(env);
  const db = mappedEnv.DB;
  if (!db) {
    throw new Error("D1 database binding missing");
  }

  // 1. Fetch records via Mold sub-app (limit=100)
  const reqRecords = new Request("http://localhost/api/sake_records?limit=100", request);
  const resRecords = await moldApp.fetch(reqRecords, mappedEnv, ctx);
  if (resRecords.status !== 200) {
    return resRecords;
  }

  const recordsData = (await resRecords.json()) as { data?: any[] };
  const records = recordsData.data || [];

  // 2. Fetch images and tags via Mold sub-app (limit=100)
  const resImages = await moldApp.fetch(new Request("http://localhost/api/sake_images?limit=100", request), mappedEnv, ctx);
  const resTags = await moldApp.fetch(new Request("http://localhost/api/tags?limit=100", request), mappedEnv, ctx);

  const rawImages = ((await resImages.json()) as { data?: any[] }).data || [];
  const rawTags = ((await resTags.json()) as { data?: any[] }).data || [];

  // 3. Fetch record_tags directly from D1 (RecordTag permissions are role:admin for REST)
  const recordIds = records.map((r: any) => r.id);
  let rawRecordTags: any[] = [];
  if (recordIds.length > 0) {
    const placeholders = recordIds.map(() => "?").join(",");
    const stmt = await db
      .prepare(`SELECT sake_record_id, tag_id, created_at FROM record_tags WHERE sake_record_id IN (${placeholders})`)
      .bind(...recordIds)
      .all<any>();
    rawRecordTags = stmt.results || [];
  }

  // 4. DYNAMIC USER & ID REMAPPING LAYER (NO hardcoding!)
  const ownerIds = Array.from(
    new Set([
      ...records.map((r: any) => r.owner_id),
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

  const sakeMap = new Map<number, string>(records.map((r: any) => [r.id, r.legacy_id || String(r.id)]));
  const tagMap = new Map<number, string>(rawTags.map((t: any) => [t.id, t.legacy_id || String(t.id)]));

  const remappedRecords = records.map((r: any) => {
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

  // record_tags: id and updated_at explicitly excluded per legacy contract
  const remappedRecordTags = rawRecordTags.map((rt: any) => ({
    sake_record_id: sakeMap.get(rt.sake_record_id) || String(rt.sake_record_id),
    record_id: sakeMap.get(rt.sake_record_id) || String(rt.sake_record_id),
    tag_id: tagMap.get(rt.tag_id) || String(rt.tag_id),
    created_at: rt.created_at,
  }));

  // 5. Group by record_id to prevent cross-record data leakage
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

  // 6. Build entry objects
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

export { moldApp };

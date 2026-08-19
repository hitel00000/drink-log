import { DEFAULT_SAKE_TAGS } from "../constants/defaultTags";
import type {
  SakeDraft,
  SakeImage,
  SakeRecord,
  SakeRecordEntry,
  SakeRecordTag,
  SakeTag,
  SakeTagGroup,
} from "../types/sake";

const DB_NAME = "alcohol-log-db";
const DB_VERSION = 3;
const SAKE_RECORDS_STORE = "sake_records";
const SAKE_IMAGES_STORE = "sake_images";
const SAKE_TAGS_STORE = "tags";
const SAKE_RECORD_TAGS_STORE = "record_tags";
const CLOUD_IMAGE_SRC_PREFIX = "/api/images?key=";
const CLOUD_ENTRIES_PATH = "/api/entries";
const CLOUD_SAKE_RECORDS_PATH = "/api/sake_records";
const CLOUD_SAKE_IMAGES_PATH = "/api/sake_images";
const CLOUD_TAGS_PATH = "/api/tags";
const CLOUD_RECORD_TAGS_PATH = "/api/record_tags";
const LOCAL_OWNER_ID = "local";
const MAX_CUSTOM_TAG_LABEL_LENGTH = 20;

let cloudStorageEnabled = false;
let defaultSakeTagsSeeded = false;

export class CloudStorageError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "CloudStorageError";
    this.status = status;
    this.code = code;
  }
}

export function setCloudStorageEnabled(enabled: boolean) {
  cloudStorageEnabled = enabled;
}

async function cloudRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const requestPath =
    method === "GET"
      ? `${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}`
      : path;

  const response = await fetch(requestPath, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let code: string | null = null;
    try {
      const payload = (await response.clone().json()) as { error?: unknown };
      code = typeof payload.error === "string" ? payload.error : null;
    } catch {
      code = null;
    }

    throw new CloudStorageError(
      response.status,
      `Cloud storage request failed: ${response.status}`,
      code,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function cloudFetchData<T>(path: string, init?: RequestInit): Promise<T> {
  const json = await cloudRequest<any>(path, init);
  if (json && typeof json === "object" && "data" in json) {
    return json.data as T;
  }
  return json as T;
}

async function fetchAllPages<T>(basePath: string): Promise<T[]> {
  const limit = 100;
  let offset = 0;
  let allItems: T[] = [];
  let hasMore = true;
  const maxSafetyIterations = 100;
  let iteration = 0;

  while (hasMore && iteration < maxSafetyIterations) {
    iteration++;
    const separator = basePath.includes("?") ? "&" : "?";
    const path = `${basePath}${separator}limit=${limit}&offset=${offset}`;

    let raw: any;
    try {
      raw = await cloudRequest<any>(path);
    } catch (error) {
      console.error(`fetchAllPages failed on ${path}:`, error);
      break;
    }

    let items: T[] = [];
    if (raw && typeof raw === "object" && "data" in raw && Array.isArray(raw.data)) {
      items = raw.data as T[];
    } else if (Array.isArray(raw)) {
      items = raw as T[];
    }

    if (items.length === 0) {
      break;
    }

    allItems = allItems.concat(items);

    const total = typeof raw?.meta?.total === "number" ? raw.meta.total : null;
    if (total !== null && allItems.length >= total) {
      hasMore = false;
    } else if (items.length < limit) {
      hasMore = false;
    } else {
      offset += items.length;
    }
  }

  return allItems;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;

      if (!db.objectStoreNames.contains(SAKE_RECORDS_STORE)) {
        const store = db.createObjectStore(SAKE_RECORDS_STORE, { keyPath: "id" });
        store.createIndex("owner_id", "owner_id", { unique: false });
        store.createIndex("drink_type", "drink_type", { unique: false });
        store.createIndex("consumed_date", "consumed_date", { unique: false });
        store.createIndex("updated_at", "updated_at", { unique: false });
      }

      if (!db.objectStoreNames.contains(SAKE_IMAGES_STORE)) {
        const store = db.createObjectStore(SAKE_IMAGES_STORE, { keyPath: "id" });
        store.createIndex("owner_id", "owner_id", { unique: false });
        store.createIndex("record_id", "record_id", { unique: false });
        store.createIndex("display_order", "display_order", { unique: false });
      }

      if (!db.objectStoreNames.contains(SAKE_TAGS_STORE)) {
        const store = db.createObjectStore(SAKE_TAGS_STORE, { keyPath: "id" });
        store.createIndex("owner_id", "owner_id", { unique: false });
        store.createIndex("drink_type", "drink_type", { unique: false });
        store.createIndex("tag_group", "tag_group", { unique: false });
        store.createIndex("drink_type_tag_group", ["drink_type", "tag_group"], {
          unique: false,
        });
      }

      if (!db.objectStoreNames.contains(SAKE_RECORD_TAGS_STORE)) {
        const store = db.createObjectStore(SAKE_RECORD_TAGS_STORE, {
          keyPath: ["record_id", "tag_id"],
        });
        store.createIndex("record_id", "record_id", { unique: false });
        store.createIndex("tag_id", "tag_id", { unique: false });
      }

      if (transaction && db.objectStoreNames.contains(SAKE_TAGS_STORE)) {
        const tagsStore = transaction.objectStore(SAKE_TAGS_STORE);
        putMissingDefaultSakeTags(tagsStore, [], new Date().toISOString());
      }
    };
  });
}

function withStores<T>(
  mode: IDBTransactionMode,
  storeNames: string[],
  action: (
    stores: Record<string, IDBObjectStore>,
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeNames, mode);
        const stores = Object.fromEntries(
          storeNames.map((storeName) => [storeName, transaction.objectStore(storeName)]),
        );

        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => db.close();

        action(stores, resolve, reject);
      }),
  );
}

function getAllFromStore<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve((request.result as T[]) ?? []);
  });
}

function getByKey<T>(store: IDBObjectStore, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T | undefined);
  });
}

function getAllByIndex<T>(
  store: IDBObjectStore,
  indexName: string,
  key: string,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = store.index(indexName).getAll(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve((request.result as T[]) ?? []);
  });
}

function normalizeOptionalText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSelectedTagIds(tagIds: (number | string)[]) {
  return Array.from(
    new Set(
      tagIds
        .map((tagId) => (typeof tagId === "string" ? tagId.trim() : tagId))
        .filter((tagId): tagId is number | string => Boolean(tagId)),
    ),
  );
}

function normalizeSakeTagLabelForCompare(label: string) {
  return label.trim().toLocaleLowerCase();
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function putMissingDefaultSakeTags(
  store: IDBObjectStore,
  existingTags: SakeTag[],
  createdAt: string,
) {
  const existingTagsById = new Map(existingTags.map((tag) => [tag.id, tag]));

  DEFAULT_SAKE_TAGS.forEach((tag) => {
    const existingTag = existingTagsById.get(tag.id);
    if (!existingTag) {
      store.put({
        ...tag,
        created_at: createdAt,
      } satisfies SakeTag);
      return;
    }

    if (
      existingTag.label !== tag.label ||
      existingTag.tag_group !== tag.tag_group ||
      existingTag.drink_type !== tag.drink_type ||
      existingTag.owner_id !== tag.owner_id ||
      !existingTag.is_default
    ) {
      store.put({
        ...existingTag,
        ...tag,
      } satisfies SakeTag);
    }
  });
}

function createSakeImageKey(ownerId: string, recordId: string, image: SakeDraft["images"][number]) {
  const extension = image.file_name.split(".").pop() || image.mime_type.split("/").pop() || "jpg";
  return `images/${ownerId}/sake/${recordId}/${image.id}.${extension}`;
}

function buildSakeEntryFromDraft(
  draft: SakeDraft,
  recordId: string,
  ownerId: string,
  createdAt: string,
  updatedAt: string,
  existingImagesById = new Map<number | string, SakeImage>(),
): { record: SakeRecord; images: SakeImage[]; recordTags: SakeRecordTag[] } {
  const name = draft.name.trim();
  if (!name) {
    throw new Error("Sake record name is required.");
  }

  const record: SakeRecord = {
    id: recordId,
    owner_id: ownerId,
    drink_type: "sake",
    name,
    region: normalizeOptionalText(draft.region),
    brewery: normalizeOptionalText(draft.brewery),
    rice: normalizeOptionalText(draft.rice),
    sake_type: normalizeOptionalText(draft.sake_type),
    sake_meter_value: normalizeOptionalText(draft.sake_meter_value),
    abv: normalizeOptionalText(draft.abv),
    volume: normalizeOptionalText(draft.volume),
    price: normalizeOptionalText(draft.price),
    drink_again: draft.drink_again,
    sweet_dry: draft.sweet_dry,
    aroma_intensity: draft.aroma_intensity,
    acidity: draft.acidity,
    clean_umami: draft.clean_umami,
    one_line_note: normalizeOptionalText(draft.one_line_note),
    place: normalizeOptionalText(draft.place),
    consumed_date: draft.consumed_date,
    companions: normalizeOptionalText(draft.companions),
    food_pairing: normalizeOptionalText(draft.food_pairing),
    created_at: createdAt,
    updated_at: updatedAt,
  };

  const images = draft.images.map((image, index) => {
    const existingImage = existingImagesById.get(image.id) ?? existingImagesById.get(String(image.id));

    return {
      id: image.id,
      owner_id: ownerId,
      record_id: recordId,
      image_key: existingImage?.image_key ?? createSakeImageKey(ownerId, recordId, image),
      thumbnail_key:
        existingImage?.thumbnail_key ?? `thumbnails/${ownerId}/sake/${recordId}/${image.id}.webp`,
      data_url: image.data_url,
      thumbnail_data_url: image.thumbnail_data_url ?? existingImage?.thumbnail_data_url ?? null,
      mime_type: image.mime_type,
      file_name: image.file_name,
      display_order: index,
      created_at: existingImage?.created_at ?? createdAt,
    };
  });

  const recordTags: SakeRecordTag[] = normalizeSelectedTagIds(draft.selected_tag_ids).map((tagId) => ({
    sake_record_id: recordId,
    record_id: recordId,
    tag_id: tagId,
    created_at: updatedAt,
  }));

  return { record, images, recordTags };
}

async function getAllSakeTagsFromStore(store: IDBObjectStore) {
  const tags = await requestToPromise<SakeTag[]>(store.getAll());
  return tags ?? [];
}

function sortSakeTags(tags: SakeTag[]) {
  const groupOrder: Record<SakeTagGroup, number> = { taste: 0, aroma: 1, mood: 2 };
  const defaultOrder = new Map(DEFAULT_SAKE_TAGS.map((tag, index) => [tag.id, index]));

  return [...tags].sort((left, right) => {
    const groupCompare = groupOrder[left.tag_group] - groupOrder[right.tag_group];
    if (groupCompare !== 0) {
      return groupCompare;
    }

    const leftDefaultOrder = defaultOrder.get(left.id);
    const rightDefaultOrder = defaultOrder.get(right.id);
    if (leftDefaultOrder !== undefined || rightDefaultOrder !== undefined) {
      return (leftDefaultOrder ?? Number.MAX_SAFE_INTEGER) - (rightDefaultOrder ?? Number.MAX_SAFE_INTEGER);
    }

    return left.created_at.localeCompare(right.created_at) || left.label.localeCompare(right.label);
  });
}

export async function seedSakeTagsIfNeeded(): Promise<void> {
  if (defaultSakeTagsSeeded) {
    return;
  }

  await withStores<void>(
    "readwrite",
    [SAKE_TAGS_STORE],
    async (stores, resolve, reject) => {
      try {
        const store = stores[SAKE_TAGS_STORE];
        const currentTags = await getAllSakeTagsFromStore(store);
        putMissingDefaultSakeTags(store, currentTags, new Date().toISOString());
        defaultSakeTagsSeeded = true;
        resolve();
      } catch (error) {
        reject(error);
      }
    },
  );
}

export async function loadSakeTags(ownerId: number | string = LOCAL_OWNER_ID): Promise<SakeTag[]> {
  if (cloudStorageEnabled) {
    const tags = await fetchAllPages<SakeTag>(CLOUD_TAGS_PATH);
    return sortSakeTags(tags.map((tag) => ({ ...tag, is_default: Boolean(tag.is_default) })));
  }

  await seedSakeTagsIfNeeded();

  return withStores<SakeTag[]>(
    "readonly",
    [SAKE_TAGS_STORE],
    async (stores, resolve, reject) => {
      try {
        const store = stores[SAKE_TAGS_STORE];
        const tags = await getAllSakeTagsFromStore(store);
        resolve(
          sortSakeTags(
            tags.filter(
              (tag) =>
                tag.drink_type === "sake" &&
                (tag.owner_id === null || tag.owner_id === ownerId),
            ),
          ),
        );
      } catch (error) {
        reject(error);
      }
    },
  );
}

export async function createCustomSakeTag(
  tagGroup: SakeTagGroup,
  label: string,
  ownerId = LOCAL_OWNER_ID,
): Promise<SakeTag | null> {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    return null;
  }

  const normalizedLabel = trimmedLabel.slice(0, MAX_CUSTOM_TAG_LABEL_LENGTH);
  const compareLabel = normalizeSakeTagLabelForCompare(normalizedLabel);

  if (cloudStorageEnabled) {
    const tag = await cloudFetchData<SakeTag>(CLOUD_TAGS_PATH, {
      method: "POST",
      body: JSON.stringify({
        drink_type: "sake",
        tag_group: tagGroup,
        label: normalizedLabel,
      }),
    });
    return { ...tag, is_default: Boolean(tag.is_default) };
  }

  return withStores<SakeTag | null>(
    "readwrite",
    [SAKE_TAGS_STORE],
    async (stores, resolve, reject) => {
      try {
        const store = stores[SAKE_TAGS_STORE];
        const tags = await getAllSakeTagsFromStore(store);
        const existingTag = tags.find(
          (tag) =>
            tag.drink_type === "sake" &&
            tag.tag_group === tagGroup &&
            normalizeSakeTagLabelForCompare(tag.label) === compareLabel &&
            (tag.owner_id === null || tag.owner_id === ownerId),
        );

        if (existingTag) {
          resolve(existingTag);
          return;
        }

        const now = new Date().toISOString();
        const tag: SakeTag = {
          id: crypto.randomUUID(),
          owner_id: ownerId,
          drink_type: "sake",
          tag_group: tagGroup,
          label: normalizedLabel,
          is_default: false,
          created_at: now,
        };

        await requestToPromise(store.put(tag));
        resolve(tag);
      } catch (error) {
        reject(error);
      }
    },
  );
}

function buildSakeRecordEntry(
  record: SakeRecord,
  images: SakeImage[],
  recordTags: SakeRecordTag[],
  tags: SakeTag[],
): SakeRecordEntry {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const selectedTags = recordTags
    .map((recordTag) => tagsById.get(recordTag.tag_id))
    .filter((tag): tag is SakeTag => Boolean(tag));

  const normalizedImages = images.map((img) => ({
    ...img,
    data_url:
      img.data_url ||
      (img.image_key
        ? img.image_key.startsWith("data:") || img.image_key.startsWith("/")
          ? img.image_key
          : `${CLOUD_IMAGE_SRC_PREFIX}${encodeURIComponent(img.image_key)}`
        : ""),
    thumbnail_data_url:
      img.thumbnail_data_url ||
      (img.thumbnail_key
        ? img.thumbnail_key.startsWith("data:") || img.thumbnail_key.startsWith("/")
          ? img.thumbnail_key
          : `${CLOUD_IMAGE_SRC_PREFIX}${encodeURIComponent(img.thumbnail_key)}`
        : null),
  }));

  return {
    id: record.id,
    record,
    images: [...normalizedImages].sort((left, right) => left.display_order - right.display_order),
    tags: sortSakeTags(selectedTags),
    record_tags: recordTags,
  };
}

export async function loadSakeRecords(
  ownerId: number | string = LOCAL_OWNER_ID,
): Promise<SakeRecordEntry[]> {
  if (cloudStorageEnabled) {
    // Mold Native Eager Loading (?include=images,record_tags) + Tags (2 HTTP requests)
    const [recordsWithIncludes, tags] = await Promise.all([
      fetchAllPages<SakeRecord & { images?: SakeImage[]; record_tags?: SakeRecordTag[] }>(
        `${CLOUD_SAKE_RECORDS_PATH}?include=images,record_tags`,
      ),
      loadSakeTags(ownerId),
    ]);

    return recordsWithIncludes
      .filter((record) => record.drink_type === "sake")
      .map((record) =>
        buildSakeRecordEntry(
          record,
          record.images ?? [],
          record.record_tags ?? [],
          tags,
        ),
      )
      .sort(
        (left, right) =>
          right.record.consumed_date.localeCompare(left.record.consumed_date) ||
          right.record.created_at.localeCompare(left.record.created_at),
      );
  }

  return withStores<SakeRecordEntry[]>(
    "readonly",
    [SAKE_RECORDS_STORE, SAKE_IMAGES_STORE, SAKE_RECORD_TAGS_STORE, SAKE_TAGS_STORE],
    async (stores, resolve, reject) => {
      try {
        const [records, images, recordTags, tags] = await Promise.all([
          getAllFromStore<SakeRecord>(stores[SAKE_RECORDS_STORE]),
          getAllFromStore<SakeImage>(stores[SAKE_IMAGES_STORE]),
          getAllFromStore<SakeRecordTag>(stores[SAKE_RECORD_TAGS_STORE]),
          getAllFromStore<SakeTag>(stores[SAKE_TAGS_STORE]),
        ]);

        const imagesByRecordId = new Map<string, SakeImage[]>();
        images.forEach((image) => {
          if (String(image.owner_id) !== String(ownerId)) {
            return;
          }
          const group = imagesByRecordId.get(String(image.record_id)) ?? [];
          group.push(image);
          imagesByRecordId.set(String(image.record_id), group);
        });

        const recordTagsByRecordId = new Map<string, SakeRecordTag[]>();
        recordTags.forEach((recordTag) => {
          const recId = recordTag.sake_record_id ?? recordTag.record_id;
          if (!recId) return;
          const group = recordTagsByRecordId.get(String(recId)) ?? [];
          group.push(recordTag);
          recordTagsByRecordId.set(String(recId), group);
        });

        resolve(
          records
            .filter((record) => String(record.owner_id) === String(ownerId) && record.drink_type === "sake")
            .map((record) =>
              buildSakeRecordEntry(
                record,
                imagesByRecordId.get(String(record.id)) ?? [],
                recordTagsByRecordId.get(String(record.id)) ?? [],
                tags,
              ),
            )
            .sort((left, right) =>
              right.record.consumed_date.localeCompare(left.record.consumed_date) ||
              right.record.created_at.localeCompare(left.record.created_at),
            ),
        );
      } catch (error) {
        reject(error);
      }
    },
  );
}

export async function getSakeRecordById(
  id: number | string,
  ownerId: number | string = LOCAL_OWNER_ID,
): Promise<SakeRecordEntry | undefined> {
  if (cloudStorageEnabled) {
    try {
      // 1. Primary: Mold Native single item fetch with eager loading
      const [recordWithIncludes, tags] = await Promise.all([
        cloudFetchData<SakeRecord & { images?: SakeImage[]; record_tags?: SakeRecordTag[] }>(
          `${CLOUD_SAKE_RECORDS_PATH}/${id}?include=images,record_tags`,
        ),
        loadSakeTags(ownerId),
      ]);

      if (!recordWithIncludes || recordWithIncludes.drink_type !== "sake") {
        return undefined;
      }

      return buildSakeRecordEntry(
        recordWithIncludes,
        recordWithIncludes.images ?? [],
        recordWithIncludes.record_tags ?? [],
        tags,
      );
    } catch (error) {
      if (error instanceof CloudStorageError && error.status === 404) {
        return undefined;
      }
      console.warn("Mold Native single fetch failed, falling back to full list search:", error);
      const records = await loadSakeRecords(ownerId);
      return records.find((r) => String(r.id) === String(id));
    }
  }

  return withStores<SakeRecordEntry | undefined>(
    "readonly",
    [SAKE_RECORDS_STORE, SAKE_IMAGES_STORE, SAKE_RECORD_TAGS_STORE, SAKE_TAGS_STORE],
    async (stores, resolve, reject) => {
      try {
        const record = await getByKey<SakeRecord>(stores[SAKE_RECORDS_STORE], String(id));
        if (!record || String(record.owner_id) !== String(ownerId) || record.drink_type !== "sake") {
          resolve(undefined);
          return;
        }

        const [images, recordTags, tags] = await Promise.all([
          getAllByIndex<SakeImage>(stores[SAKE_IMAGES_STORE], "record_id", String(id)),
          getAllByIndex<SakeRecordTag>(stores[SAKE_RECORD_TAGS_STORE], "record_id", String(id)),
          getAllFromStore<SakeTag>(stores[SAKE_TAGS_STORE]),
        ]);

        resolve(buildSakeRecordEntry(record, images, recordTags, tags));
      } catch (error) {
        reject(error);
      }
    },
  );
}

export async function saveSakeRecord(
  draft: SakeDraft,
  ownerId: number | string = LOCAL_OWNER_ID,
): Promise<SakeRecordEntry> {
  const now = new Date().toISOString();

  if (cloudStorageEnabled) {
    try {
      const entry = await cloudFetchData<SakeRecordEntry>(CLOUD_ENTRIES_PATH, {
        method: "POST",
        body: JSON.stringify(draft),
      });
      if (entry && entry.id) {
        return entry;
      }
    } catch (error) {
      console.warn("One-shot POST /api/entries failed, falling back to legacy multi-step:", error);
    }

    let createdRecordId: number | string | null = null;
    const createdImageIds: (number | string)[] = [];
    const createdRecordTagIds: (number | string)[] = [];

    try {
      const recordBody = {
        drink_type: "sake",
        name: draft.name.trim(),
        region: draft.region.trim() || null,
        brewery: draft.brewery.trim() || null,
        rice: draft.rice.trim() || null,
        sake_type: draft.sake_type.trim() || null,
        sake_meter_value: draft.sake_meter_value.trim() || null,
        abv: draft.abv.trim() || null,
        volume: draft.volume.trim() || null,
        price: draft.price.trim() || null,
        drink_again: draft.drink_again,
        sweet_dry: draft.sweet_dry,
        aroma_intensity: draft.aroma_intensity,
        acidity: draft.acidity,
        clean_umami: draft.clean_umami,
        one_line_note: draft.one_line_note.trim() || null,
        place: draft.place.trim() || null,
        consumed_date: draft.consumed_date,
        companions: draft.companions.trim() || null,
        food_pairing: draft.food_pairing.trim() || null,
      };

      const record = await cloudFetchData<SakeRecord>(CLOUD_SAKE_RECORDS_PATH, {
        method: "POST",
        body: JSON.stringify(recordBody),
      });
      createdRecordId = record.id;

      for (const imgDraft of draft.images) {
        const imgBody = {
          record_id: Number(createdRecordId),
          image_key: imgDraft.data_url,
          thumbnail_key: imgDraft.thumbnail_data_url || null,
          mime_type: imgDraft.mime_type || "image/jpeg",
          file_name: imgDraft.file_name || "photo.jpg",
          display_order: Number(imgDraft.display_order ?? 0),
        };
        const createdImg = await cloudFetchData<SakeImage>(CLOUD_SAKE_IMAGES_PATH, {
          method: "POST",
          body: JSON.stringify(imgBody),
        });
        if (createdImg?.id) {
          createdImageIds.push(createdImg.id);
        }
      }

      for (const tagId of draft.selected_tag_ids) {
        const rtBody = {
          sake_record_id: createdRecordId,
          tag_id: tagId,
        };
        const createdRt = await cloudFetchData<SakeRecordTag>(CLOUD_RECORD_TAGS_PATH, {
          method: "POST",
          body: JSON.stringify(rtBody),
        });
        if (createdRt?.id) {
          createdRecordTagIds.push(createdRt.id);
        }
      }

      const entry = await getSakeRecordById(createdRecordId);
      if (!entry) {
        throw new Error("Failed to load saved sake record");
      }
      return entry;
    } catch (error) {
      console.error("Save sake record failed. Rolling back all created items...", error);

      for (const rtId of createdRecordTagIds) {
        await cloudRequest(`${CLOUD_RECORD_TAGS_PATH}/${encodeURIComponent(String(rtId))}`, {
          method: "DELETE",
        }).catch(() => {});
      }

      for (const imgId of createdImageIds) {
        await cloudRequest(`${CLOUD_SAKE_IMAGES_PATH}/${encodeURIComponent(String(imgId))}`, {
          method: "DELETE",
        }).catch(() => {});
      }

      if (createdRecordId !== null) {
        await cloudRequest(`${CLOUD_SAKE_RECORDS_PATH}/${encodeURIComponent(String(createdRecordId))}`, {
          method: "DELETE",
        }).catch(() => {});
      }
      throw error;
    }
  }

  const recordId = crypto.randomUUID();
  const { record, images, recordTags } = buildSakeEntryFromDraft(
    draft,
    recordId,
    String(ownerId),
    now,
    now,
  );

  return withStores<SakeRecordEntry>(
    "readwrite",
    [SAKE_RECORDS_STORE, SAKE_IMAGES_STORE, SAKE_RECORD_TAGS_STORE, SAKE_TAGS_STORE],
    async (stores, resolve, reject) => {
      try {
        await requestToPromise(stores[SAKE_RECORDS_STORE].put(record));

        await Promise.all(
          images.map((image) => requestToPromise(stores[SAKE_IMAGES_STORE].put(image))),
        );
        await Promise.all(
          recordTags.map((recordTag) =>
            requestToPromise(stores[SAKE_RECORD_TAGS_STORE].put(recordTag)),
          ),
        );

        const tags = await getAllFromStore<SakeTag>(stores[SAKE_TAGS_STORE]);
        resolve(buildSakeRecordEntry(record, images, recordTags, tags));
      } catch (error) {
        reject(error);
      }
    },
  );
}

export async function updateSakeRecord(
  id: number | string,
  draft: SakeDraft,
  ownerId: number | string = LOCAL_OWNER_ID,
): Promise<SakeRecordEntry> {
  if (cloudStorageEnabled) {
    try {
      const entry = await cloudFetchData<SakeRecordEntry>(
        `${CLOUD_ENTRIES_PATH}/${encodeURIComponent(String(id))}`,
        {
          method: "PUT",
          body: JSON.stringify(draft),
        },
      );
      if (entry && entry.id) {
        return entry;
      }
    } catch (err) {
      console.warn("One-shot PUT /api/entries/:id failed, falling back to legacy update:", err);
    }

    const recordBody = {
      name: draft.name.trim(),
      region: draft.region.trim() || null,
      brewery: draft.brewery.trim() || null,
      rice: draft.rice.trim() || null,
      sake_type: draft.sake_type.trim() || null,
      sake_meter_value: draft.sake_meter_value.trim() || null,
      abv: draft.abv.trim() || null,
      volume: draft.volume.trim() || null,
      price: draft.price.trim() || null,
      drink_again: draft.drink_again,
      sweet_dry: draft.sweet_dry,
      aroma_intensity: draft.aroma_intensity,
      acidity: draft.acidity,
      clean_umami: draft.clean_umami,
      one_line_note: draft.one_line_note.trim() || null,
      place: draft.place.trim() || null,
      consumed_date: draft.consumed_date,
      companions: draft.companions.trim() || null,
      food_pairing: draft.food_pairing.trim() || null,
    };

    await cloudFetchData<SakeRecord>(`${CLOUD_SAKE_RECORDS_PATH}/${encodeURIComponent(String(id))}`, {
      method: "PUT",
      body: JSON.stringify(recordBody),
    });

    const [existingImages, existingRecordTags] = await Promise.all([
      fetchAllPages<SakeImage>(CLOUD_SAKE_IMAGES_PATH),
      fetchAllPages<SakeRecordTag>(CLOUD_RECORD_TAGS_PATH),
    ]);

    const targetImages = existingImages.filter((img) => String(img.record_id) === String(id));
    const targetRecordTags = existingRecordTags.filter(
      (rt) => String(rt.sake_record_id ?? rt.record_id) === String(id),
    );

    await Promise.all([
      ...targetImages.map((img) =>
        cloudRequest(`${CLOUD_SAKE_IMAGES_PATH}/${encodeURIComponent(String(img.id))}`, { method: "DELETE" }),
      ),
      ...targetRecordTags.map((rt) =>
        rt.id
          ? cloudRequest(`${CLOUD_RECORD_TAGS_PATH}/${encodeURIComponent(String(rt.id))}`, { method: "DELETE" })
          : Promise.resolve(),
      ),
    ]);

    for (const imgDraft of draft.images) {
      const imgBody = {
        record_id: Number(id),
        image_key: imgDraft.data_url,
        thumbnail_key: imgDraft.thumbnail_data_url || null,
        mime_type: imgDraft.mime_type || "image/jpeg",
        file_name: imgDraft.file_name || "photo.jpg",
        display_order: Number(imgDraft.display_order ?? 0),
      };
      await cloudFetchData<SakeImage>(CLOUD_SAKE_IMAGES_PATH, {
        method: "POST",
        body: JSON.stringify(imgBody),
      });
    }

    for (const tagId of draft.selected_tag_ids) {
      const rtBody = {
        sake_record_id: id,
        tag_id: tagId,
      };
      await cloudFetchData<SakeRecordTag>(CLOUD_RECORD_TAGS_PATH, {
        method: "POST",
        body: JSON.stringify(rtBody),
      });
    }

    const entry = await getSakeRecordById(id);
    if (!entry) {
      throw new Error("Failed to load updated sake record");
    }
    return entry;
  }

  const stringId = String(id);
  return withStores<SakeRecordEntry>(
    "readwrite",
    [SAKE_RECORDS_STORE, SAKE_IMAGES_STORE, SAKE_RECORD_TAGS_STORE, SAKE_TAGS_STORE],
    async (stores, resolve, reject) => {
      try {
        const existingRecord = await getByKey<SakeRecord>(stores[SAKE_RECORDS_STORE], stringId);
        if (!existingRecord || String(existingRecord.owner_id) !== String(ownerId)) {
          reject(new Error("Sake record not found."));
          return;
        }

        const [existingImages, existingRecordTags] = await Promise.all([
          getAllByIndex<SakeImage>(stores[SAKE_IMAGES_STORE], "record_id", stringId),
          getAllByIndex<SakeRecordTag>(stores[SAKE_RECORD_TAGS_STORE], "record_id", stringId),
        ]);
        const existingImagesById = new Map<number | string, SakeImage>(
          existingImages.map((image) => [image.id, image]),
        );
        const now = new Date().toISOString();
        const { record, images, recordTags } = buildSakeEntryFromDraft(
          draft,
          stringId,
          String(ownerId),
          existingRecord.created_at,
          now,
          existingImagesById,
        );
        const nextImageIds = new Set(images.map((image) => image.id));
        const nextTagIds = new Set(recordTags.map((recordTag) => recordTag.tag_id));

        await Promise.all([
          requestToPromise(stores[SAKE_RECORDS_STORE].put(record)),
          ...existingImages
            .filter((image) => !nextImageIds.has(image.id))
            .map((image) => requestToPromise(stores[SAKE_IMAGES_STORE].delete(image.id))),
          ...existingRecordTags
            .filter((recordTag) => !nextTagIds.has(recordTag.tag_id))
            .map((recordTag) =>
              requestToPromise(
                stores[SAKE_RECORD_TAGS_STORE].delete([recordTag.record_id ?? recordTag.sake_record_id, recordTag.tag_id]),
              ),
            ),
          ...images.map((image) => requestToPromise(stores[SAKE_IMAGES_STORE].put(image))),
          ...recordTags.map((recordTag) => requestToPromise(stores[SAKE_RECORD_TAGS_STORE].put(recordTag))),
        ]);

        const tags = await getAllFromStore<SakeTag>(stores[SAKE_TAGS_STORE]);
        resolve(buildSakeRecordEntry(record, images, recordTags, tags));
      } catch (error) {
        reject(error);
      }
    },
  );
}

export async function deleteSakeRecord(
  id: number | string,
  ownerId: number | string = LOCAL_OWNER_ID,
): Promise<void> {
  if (cloudStorageEnabled) {
    try {
      await cloudRequest<void>(`${CLOUD_ENTRIES_PATH}/${encodeURIComponent(String(id))}`, {
        method: "DELETE",
      });
      return;
    } catch (err) {
      console.warn("One-shot DELETE /api/entries/:id failed, falling back to legacy delete:", err);
    }

    const [existingImages, existingRecordTags] = await Promise.all([
      fetchAllPages<SakeImage>(CLOUD_SAKE_IMAGES_PATH),
      fetchAllPages<SakeRecordTag>(CLOUD_RECORD_TAGS_PATH),
    ]);

    const targetImages = existingImages.filter((img) => String(img.record_id) === String(id));
    const targetRecordTags = existingRecordTags.filter(
      (rt) => String(rt.sake_record_id ?? rt.record_id) === String(id),
    );

    await Promise.all([
      ...targetRecordTags.map((rt) =>
        rt.id
          ? cloudRequest(`${CLOUD_RECORD_TAGS_PATH}/${encodeURIComponent(String(rt.id))}`, { method: "DELETE" })
          : Promise.resolve(),
      ),
      ...targetImages.map((img) =>
        cloudRequest(`${CLOUD_SAKE_IMAGES_PATH}/${encodeURIComponent(String(img.id))}`, { method: "DELETE" }),
      ),
    ]);

    await cloudRequest<void>(`${CLOUD_SAKE_RECORDS_PATH}/${encodeURIComponent(String(id))}`, {
      method: "DELETE",
    });
    return;
  }

  const stringId = String(id);
  return withStores<void>(
    "readwrite",
    [SAKE_RECORDS_STORE, SAKE_IMAGES_STORE, SAKE_RECORD_TAGS_STORE],
    async (stores, resolve, reject) => {
      try {
        const record = await getByKey<SakeRecord>(stores[SAKE_RECORDS_STORE], stringId);
        if (!record || String(record.owner_id) !== String(ownerId)) {
          resolve();
          return;
        }

        const [images, recordTags] = await Promise.all([
          getAllByIndex<SakeImage>(stores[SAKE_IMAGES_STORE], "record_id", stringId),
          getAllByIndex<SakeRecordTag>(stores[SAKE_RECORD_TAGS_STORE], "record_id", stringId),
        ]);

        await Promise.all([
          requestToPromise(stores[SAKE_RECORDS_STORE].delete(stringId)),
          ...images.map((image) => requestToPromise(stores[SAKE_IMAGES_STORE].delete(image.id))),
          ...recordTags.map((recordTag) =>
            requestToPromise(
              stores[SAKE_RECORD_TAGS_STORE].delete([recordTag.record_id ?? recordTag.sake_record_id, recordTag.tag_id]),
            ),
          ),
        ]);

        resolve();
      } catch (error) {
        reject(error);
      }
    },
  );
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export async function fileToThumbnailDataUrl(
  file: File,
  maxSize = 720,
  quality = 0.82,
): Promise<string> {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
      img.src = imageUrl;
    });

    const ratio = Math.min(maxSize / image.naturalWidth, maxSize / image.naturalHeight, 1);
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("썸네일을 만들 수 없습니다.");
    }

    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/webp", quality);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

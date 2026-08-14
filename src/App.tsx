import { useEffect, useMemo, useState } from "react";
import {
  ACIDITY_OPTIONS,
  AROMA_INTENSITY_OPTIONS,
  CLEAN_UMAMI_OPTIONS,
  DRINK_AGAIN_OPTIONS,
  SWEET_DRY_OPTIONS,
} from "./constants/sakeOptions";
import { createInitialSakeDraft } from "./lib/sakeDraft";
import {
  createCustomSakeTag,
  deleteSakeRecord,
  fileToDataUrl,
  fileToThumbnailDataUrl,
  getSakeRecordById,
  loadSakeRecords,
  loadSakeTags,
  CloudStorageError,
  saveSakeRecord,
  setCloudStorageEnabled,
  updateSakeRecord,
} from "./lib/storage";
import type {
  DrinkAgainValue,
  SakeDraft,
  SakeDraftImage,
  SakeRecordEntry,
  SakeTag,
  SakeTagGroup,
  SweetDryValue,
  ThreeStepRatingValue,
} from "./types/sake";

type Route =
  | { page: "compose" }
  | { page: "logs" }
  | { page: "detail"; id: string }
  | { page: "edit"; id: string };

type AuthUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

type AuthState =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "authenticated"; user: AuthUser };

type AuthSyncResult = "authenticated" | "anonymous" | "unavailable";

type StorageMode = "local" | "cloud" | "auto";

const STORAGE_MODES = new Set<StorageMode>(["local", "cloud", "auto"]);

function getStorageMode(value: string | undefined): StorageMode {
  if (value && STORAGE_MODES.has(value as StorageMode)) {
    return value as StorageMode;
  }

  return "local";
}

const STORAGE_MODE = getStorageMode(import.meta.env.VITE_STORAGE_MODE);

const TAG_GROUPS: ReadonlyArray<{ value: SakeTagGroup; label: string }> = [
  { value: "taste", label: "맛 태그" },
  { value: "aroma", label: "향 태그" },
  { value: "mood", label: "느낌 태그" },
] as const;

const EMPTY_TAG_INPUTS: Record<SakeTagGroup, string> = {
  taste: "",
  aroma: "",
  mood: "",
};

const RATING_GROUPS = [
  { key: "sweet_dry", label: "달콤함 - 드라이함", options: SWEET_DRY_OPTIONS },
  { key: "aroma_intensity", label: "은은함 - 화려함", options: AROMA_INTENSITY_OPTIONS },
  { key: "acidity", label: "산미", options: ACIDITY_OPTIONS },
  { key: "clean_umami", label: "깔끔함 - 감칠맛", options: CLEAN_UMAMI_OPTIONS },
] as const;

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean);

  if (parts[0] === "logs" && parts[1] && parts[2] === "edit") {
    return { page: "edit", id: parts[1] };
  }

  if (parts[0] === "logs" && parts[1]) {
    return { page: "detail", id: parts[1] };
  }

  if (parts[0] === "logs") {
    return { page: "logs" };
  }

  return { page: "compose" };
}

function navigateTo(route: Route) {
  if (route.page === "compose") {
    window.location.hash = "/";
    return;
  }

  if (route.page === "logs") {
    window.location.hash = "/logs";
    return;
  }

  if (route.page === "edit") {
    window.location.hash = `/logs/${route.id}/edit`;
    return;
  }

  window.location.hash = `/logs/${route.id}`;
}

function formatInputDate(value: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(
    new Date(`${value}T00:00:00`),
  );
}

function createDraftFromEntry(entry: SakeRecordEntry): SakeDraft {
  const { record } = entry;

  return {
    name: record.name,
    region: record.region ?? "",
    brewery: record.brewery ?? "",
    rice: record.rice ?? "",
    sake_type: record.sake_type ?? "",
    sake_meter_value: record.sake_meter_value ?? "",
    abv: record.abv ?? "",
    volume: record.volume ?? "",
    price: record.price ?? "",
    drink_again: record.drink_again,
    sweet_dry: record.sweet_dry,
    aroma_intensity: record.aroma_intensity,
    acidity: record.acidity,
    clean_umami: record.clean_umami,
    one_line_note: record.one_line_note ?? "",
    place: record.place ?? "",
    consumed_date: record.consumed_date,
    companions: record.companions ?? "",
    food_pairing: record.food_pairing ?? "",
    images: entry.images.map((image) => ({
      id: image.id,
      data_url: image.data_url,
      thumbnail_data_url: image.thumbnail_data_url ?? undefined,
      mime_type: image.mime_type,
      file_name: image.file_name,
      display_order: image.display_order,
    })),
    selected_tag_ids: entry.tags.map((tag) => tag.id),
  };
}

function serializeDraft(draft: SakeDraft) {
  return JSON.stringify({
    ...draft,
    name: draft.name.trim(),
    region: draft.region.trim(),
    brewery: draft.brewery.trim(),
    rice: draft.rice.trim(),
    sake_type: draft.sake_type.trim(),
    sake_meter_value: draft.sake_meter_value.trim(),
    abv: draft.abv.trim(),
    volume: draft.volume.trim(),
    price: draft.price.trim(),
    one_line_note: draft.one_line_note.trim(),
    place: draft.place.trim(),
    companions: draft.companions.trim(),
    food_pairing: draft.food_pairing.trim(),
    images: draft.images.map((image) => ({
      id: image.id,
      display_order: image.display_order,
      file_name: image.file_name,
    })),
    selected_tag_ids: [...draft.selected_tag_ids].sort(),
  });
}

function getDrinkAgainLabel(value: DrinkAgainValue | null) {
  return DRINK_AGAIN_OPTIONS.find((option) => option.value === value)?.label ?? "미선택";
}

function getRatingLabel(
  value: SweetDryValue | ThreeStepRatingValue | null,
  options: ReadonlyArray<{ value: SweetDryValue | ThreeStepRatingValue; label: string }>,
) {
  return options.find((option) => option.value === value)?.label ?? "미선택";
}

function formatOptional(value: string | null) {
  return value && value.trim() ? value : "미입력";
}

function getEntrySubtitle(entry: SakeRecordEntry) {
  const parts = [entry.record.sake_type, entry.record.region].filter(
    (value): value is string => Boolean(value),
  );

  return parts.length > 0 ? parts.join(" · ") : "종류/지역 미입력";
}

function getPrimaryTags(entry: SakeRecordEntry) {
  return entry.tags.slice(0, 3);
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

function getSearchableText(entry: SakeRecordEntry) {
  const { record } = entry;

  return [
    record.name,
    record.region,
    record.brewery,
    record.sake_type,
    record.rice,
    record.place,
    record.companions,
    record.food_pairing,
    record.one_line_note,
    ...entry.tags.map((tag) => tag.label),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLocaleLowerCase();
}

function getCloudStorageErrorMessage(error: unknown) {
  if (!(error instanceof CloudStorageError)) {
    return "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
  }

  if (error.status === 401) {
    return "로그인이 만료되었습니다. 다시 Google 로그인해 주세요.";
  }

  if (error.status === 403) {
    return "이 기록에 접근할 권한이 없습니다.";
  }

  if (error.status === 404) {
    return "기록을 찾을 수 없습니다.";
  }

  return "클라우드 저장소 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [draft, setDraft] = useState<SakeDraft>(() => createInitialSakeDraft());
  const [tags, setTags] = useState<SakeTag[]>([]);
  const [records, setRecords] = useState<SakeRecordEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<SakeRecordEntry | null>(null);
  const [activeImage, setActiveImage] = useState<SakeDraftImage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [editBaseline, setEditBaseline] = useState<string | null>(null);
  const [activeTagInput, setActiveTagInput] = useState<SakeTagGroup | null>(null);
  const [tagInputs, setTagInputs] =
    useState<Record<SakeTagGroup, string>>(EMPTY_TAG_INPUTS);
  const [auth, setAuth] = useState<AuthState>({ status: "loading", user: null });

  const selectedTagIds = useMemo(
    () => new Set(draft.selected_tag_ids),
    [draft.selected_tag_ids],
  );
  const canSave = draft.name.trim().length > 0;
  const hasUnsavedEdit =
    route.page === "edit" && editBaseline !== null && serializeDraft(draft) !== editBaseline;
  const isCloudMode = STORAGE_MODE === "cloud";
  const isLocalMode = STORAGE_MODE === "local";
  const isAutoMode = STORAGE_MODE === "auto";
  const isCloudReady = auth.status === "authenticated";
  const usesCloudStorage = isCloudMode ? isCloudReady : isAutoMode && isCloudReady;
  const canUseStorage = isLocalMode || usesCloudStorage || (isAutoMode && auth.status === "anonymous");
  const usesLocalStorage = canUseStorage && !usesCloudStorage;
  const needsCloudLogin = isCloudMode && !isCloudReady;
  const filteredRecords = useMemo(() => {
    const query = normalizeSearchText(searchQuery);
    if (!query) {
      return records;
    }

    return records.filter((entry) => getSearchableText(entry).includes(query));
  }, [records, searchQuery]);

  useEffect(() => {
    const onHashChange = () => {
      const nextRoute = parseRoute();
      const leavesCurrentEdit =
        nextRoute.page !== "edit" || (route.page === "edit" && nextRoute.id !== route.id);

      if (hasUnsavedEdit && leavesCurrentEdit) {
        const confirmed = window.confirm("수정 중인 내용이 저장되지 않았습니다. 나갈까요?");
        if (!confirmed) {
          navigateTo(route);
          return;
        }
      }

      setRoute(nextRoute);
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [hasUnsavedEdit, route]);

  useEffect(() => {
    if (route.page === "compose") {
      setDraft(createInitialSakeDraft());
      setEditBaseline(null);
      setSelectedEntry(null);
    }
  }, [route]);

  function clearCloudSessionState(message?: string | null) {
    setCloudStorageEnabled(false);
    setAuth({ status: "anonymous", user: null });
    setTags([]);
    setRecords([]);
    setSelectedEntry(null);
    setActiveImage(null);
    setIsLoading(false);
    setStatusMessage(message ?? null);
  }

  function handleStorageError(error: unknown) {
    const message = getCloudStorageErrorMessage(error);
    if (error instanceof CloudStorageError && error.status === 401) {
      clearCloudSessionState(message);
      return;
    }

    setStatusMessage(message);
  }

  useEffect(() => {
    if (isLocalMode) {
      setAuth({ status: "anonymous", user: null });
      return;
    }

    let cancelled = false;

    async function syncAuth(markLoading = false): Promise<AuthSyncResult> {
      if (markLoading && !cancelled) {
        setAuth({ status: "loading", user: null });
      }

      try {
        const response = await fetch(`/api/me?_=${Date.now()}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error("Auth endpoint unavailable.");
        }
        const payload = (await response.json()) as
          | { authenticated: false }
          | { authenticated: true; user: AuthUser };

        if (!cancelled) {
          if (payload.authenticated) {
            setAuth({ status: "authenticated", user: payload.user });
          } else if (isCloudMode) {
            clearCloudSessionState();
          } else {
            setAuth({ status: "anonymous", user: null });
          }
        }
        return payload.authenticated ? "authenticated" : "anonymous";
      } catch {
        if (!cancelled) {
          if (isCloudMode) {
            clearCloudSessionState();
          } else {
            setAuth({ status: "anonymous", user: null });
          }
        }
        return "unavailable";
      }
    }

    void syncAuth();
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void syncAuth(true);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncAuth();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isCloudMode, isLocalMode]);

  useEffect(() => {
    setCloudStorageEnabled(usesCloudStorage);
  }, [usesCloudStorage]);

  useEffect(() => {
    if (!isCloudMode || auth.status !== "anonymous") {
      return;
    }

    clearCloudSessionState();
  }, [auth.status, isCloudMode]);

  useEffect(() => {
    let cancelled = false;

    async function syncTags() {
      if (!canUseStorage) {
        return;
      }

      try {
        const nextTags = await loadSakeTags();
        if (!cancelled) {
          setTags(nextTags);
        }
      } catch (error) {
        if (!cancelled) {
          handleStorageError(error);
        }
      }
    }

    void syncTags();
    return () => {
      cancelled = true;
    };
  }, [canUseStorage, usesCloudStorage]);

  useEffect(() => {
    let cancelled = false;

    async function syncRecords() {
      if (!canUseStorage) {
        return;
      }

      setIsLoading(true);
      try {
        const nextRecords = await loadSakeRecords();
        if (!cancelled) {
          setRecords(nextRecords);
          setStatusMessage(null);
        }
      } catch (error) {
        if (!cancelled) {
          setRecords([]);
          handleStorageError(error);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void syncRecords();
    return () => {
      cancelled = true;
    };
  }, [canUseStorage, usesCloudStorage]);

  useEffect(() => {
    let cancelled = false;

    async function syncSelectedEntry() {
      if (auth.status === "loading") {
        return;
      }

      if (!canUseStorage) {
        if (!cancelled) {
          setSelectedEntry(null);
          setIsLoading(false);
        }
        return;
      }

      if (route.page !== "detail" && route.page !== "edit") {
        if (!cancelled) {
          setSelectedEntry(null);
        }
        return;
      }

      setIsLoading(true);
      try {
        const nextEntry = await getSakeRecordById(route.id);
        if (!cancelled) {
          setSelectedEntry(nextEntry ?? null);
          if (route.page === "edit" && nextEntry) {
            const nextDraft = createDraftFromEntry(nextEntry);
            setDraft(nextDraft);
            setEditBaseline(serializeDraft(nextDraft));
          }
          setIsLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setSelectedEntry(null);
          handleStorageError(error);
          setIsLoading(false);
        }
      }
    }

    void syncSelectedEntry();
    return () => {
      cancelled = true;
    };
  }, [auth.status, canUseStorage, usesCloudStorage, route]);

  function updateDraft<K extends keyof SakeDraft>(key: K, value: SakeDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleTag(tagId: number | string) {
    setDraft((current) => {
      const selected = new Set(current.selected_tag_ids);
      if (selected.has(tagId)) {
        selected.delete(tagId);
      } else {
        selected.add(tagId);
      }

      return { ...current, selected_tag_ids: Array.from(selected) };
    });
  }

  async function handleAddTag(tagGroup: SakeTagGroup) {
    if (!canUseStorage) {
      setStatusMessage(
        needsCloudLogin
          ? "클라우드 저장을 사용하려면 Google 로그인이 필요합니다."
          : "사용할 수 있는 저장소를 찾지 못했습니다.",
      );
      return;
    }

    const label = tagInputs[tagGroup];
    if (!label.trim()) {
      return;
    }

    try {
      const tag = await createCustomSakeTag(tagGroup, label);
      if (!tag) {
        return;
      }

      const nextTags = await loadSakeTags();
      setTags(nextTags);
      setDraft((current) => ({
        ...current,
        selected_tag_ids: Array.from(new Set([...current.selected_tag_ids, tag.id])),
      }));
      setTagInputs((current) => ({ ...current, [tagGroup]: "" }));
      setActiveTagInput(null);
    } catch (error) {
      handleStorageError(error);
    }
  }

  async function handleImageChange(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    const nextImages: SakeDraftImage[] = await Promise.all(
      Array.from(files).map(async (file, index) => {
        const [dataUrl, thumbnailDataUrl] = await Promise.all([
          fileToDataUrl(file),
          fileToThumbnailDataUrl(file),
        ]);

        return {
          id: crypto.randomUUID(),
          data_url: dataUrl,
          thumbnail_data_url: thumbnailDataUrl,
          mime_type: file.type || "image/jpeg",
          file_name: file.name,
          display_order: draft.images.length + index,
        };
      }),
    );

    setDraft((current) => ({
      ...current,
      images: [...current.images, ...nextImages].map((image, index) => ({
        ...image,
        display_order: index,
      })),
    }));
  }

  function handleRemoveImage(imageId: number | string) {
    setDraft((current) => ({
      ...current,
      images: current.images
        .filter((image) => image.id !== imageId)
        .map((image, index) => ({ ...image, display_order: index })),
    }));
  }

  function confirmDiscardEdit() {
    if (!hasUnsavedEdit) {
      return true;
    }

    return window.confirm("수정 중인 내용이 저장되지 않았습니다. 나갈까요?");
  }

  function handleNavigate(routeToNavigate: Route) {
    if (!confirmDiscardEdit()) {
      return;
    }

    if (routeToNavigate.page === "compose") {
      setDraft(createInitialSakeDraft());
      setEditBaseline(null);
    }

    navigateTo(routeToNavigate);
  }

  async function handleSave() {
    if (!canUseStorage) {
      setStatusMessage(
        needsCloudLogin
          ? "클라우드에 저장하려면 Google 로그인이 필요합니다."
          : "사용할 수 있는 저장소를 찾지 못했습니다.",
      );
      return;
    }

    if (!canSave) {
      setStatusMessage("술 이름은 꼭 입력해 주세요.");
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);
    try {
      const entry =
        route.page === "edit"
          ? await updateSakeRecord(route.id, draft)
          : await saveSakeRecord(draft);
      const [nextRecords, nextTags] = await Promise.all([loadSakeRecords(), loadSakeTags()]);
      setRecords(nextRecords);
      setTags(nextTags);
      setSelectedEntry(entry);
      setDraft(createInitialSakeDraft());
      setEditBaseline(null);
      navigateTo({ page: "detail", id: String(entry.id) });
      setStatusMessage(usesLocalStorage ? "이 기기에 저장했습니다." : "클라우드에 저장했습니다.");
    } catch (error) {
      handleStorageError(error);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteRecord(recordId: number | string) {
    if (!canUseStorage) {
      setStatusMessage(
        needsCloudLogin
          ? "클라우드 기록을 삭제하려면 Google 로그인이 필요합니다."
          : "사용할 수 있는 저장소를 찾지 못했습니다.",
      );
      return;
    }

    const confirmed = window.confirm("이 기록을 삭제할까요? 삭제한 기록은 되돌릴 수 없습니다.");
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteSakeRecord(recordId);
      const nextRecords = await loadSakeRecords();
      setRecords(nextRecords);
      setSelectedEntry(null);
      navigateTo({ page: "logs" });
    } catch (error) {
      handleStorageError(error);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleLogin() {
    window.location.href = "/api/auth/google/login";
  }

  function handleLogout() {
    clearCloudSessionState();
    window.location.replace(
      `/api/auth/logout?returnTo=${encodeURIComponent("/#/logs")}&_=${Date.now()}`,
    );
  }

  function renderCloudRequired() {
    if (auth.status === "loading") {
      return (
        <main className="single-column">
          <section className="panel">
            <p className="empty-copy">로그인 상태를 확인하는 중...</p>
          </section>
        </main>
      );
    }

    return (
      <main className="single-column">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="kicker">클라우드 로그인 필요</p>
              <h2>Google 로그인 후 기록할 수 있습니다</h2>
            </div>
          </div>
          <p className="empty-copy">
            사케 기록은 Cloudflare D1/R2에 저장됩니다. 이 기기의 로컬 기록과 클라우드
            기록을 섞어 보여주지 않습니다.
          </p>
          <button type="button" className="save-button" onClick={handleLogin}>
            Google 로그인
          </button>
        </section>
      </main>
    );
  }

  function renderComposer() {
    if (needsCloudLogin) {
      return renderCloudRequired();
    }

    return (
      <main className="single-column">
        {route.page === "edit" && isLoading ? (
          <section className="panel">
            <p className="empty-copy">불러오는 중...</p>
          </section>
        ) : null}

        {route.page === "edit" && !isLoading && !selectedEntry ? (
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="kicker">Edit</p>
                <h2>기록을 찾을 수 없습니다</h2>
              </div>
            </div>
            <button type="button" className="save-button" onClick={() => handleNavigate({ page: "logs" })}>
              목록으로 돌아가기
            </button>
          </section>
        ) : null}

        {route.page === "compose" || (route.page === "edit" && selectedEntry) ? (
          <section className="panel composer sake-composer">
            <div className="panel-header">
              <div>
                <p className="kicker">Sake Note</p>
                <h2>{route.page === "edit" ? "사케 기록 수정" : "오늘의 한 잔 기록"}</h2>
              </div>
              <span className="badge">{draft.images.length}장</span>
            </div>

            <section className="sake-section photo-section" aria-label="사진들">
              <label className={`upload-dropzone sake-upload ${draft.images.length > 0 ? "is-compact" : ""}`}>
                <span>{draft.images.length > 0 ? "사진 더 추가" : "사진 추가"}</span>
                <small>첫 번째 사진이 대표 이미지가 됩니다.</small>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => void handleImageChange(event.target.files)}
                />
              </label>

              {draft.images.length > 0 ? (
                <div className="sake-photo-layout">
                  <button
                    type="button"
                    className="sake-cover-photo"
                    onClick={() => setActiveImage(draft.images[0])}
                  >
                    <img
                      src={draft.images[0].data_url}
                      alt={draft.images[0].file_name}
                    />
                    <span>대표</span>
                  </button>
                  <div className="image-strip">
                    {draft.images.map((image) => (
                      <div key={image.id} className="image-preview">
                        <img src={image.thumbnail_data_url ?? image.data_url} alt={image.file_name} />
                        <button type="button" onClick={() => handleRemoveImage(image.id)}>
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="sake-section">
              <h3>기본 정보</h3>
              <div className="input-grid sake-basic-grid">
                <label className="required-field">
                  술 이름
                  <input
                    value={draft.name}
                    onChange={(event) => updateDraft("name", event.target.value)}
                    placeholder="사케 이름"
                  />
                </label>
                <label>
                  지역
                  <input
                    value={draft.region}
                    onChange={(event) => updateDraft("region", event.target.value)}
                    placeholder="니가타"
                  />
                </label>
                <label>
                  양조장
                  <input
                    value={draft.brewery}
                    onChange={(event) => updateDraft("brewery", event.target.value)}
                    placeholder="양조장"
                  />
                </label>
                <label>
                  쌀
                  <input
                    value={draft.rice}
                    onChange={(event) => updateDraft("rice", event.target.value)}
                    placeholder="야마다니시키"
                  />
                </label>
                <label>
                  종류
                  <input
                    value={draft.sake_type}
                    onChange={(event) => updateDraft("sake_type", event.target.value)}
                    placeholder="준마이긴죠"
                  />
                </label>
                <label>
                  일본주도
                  <input
                    value={draft.sake_meter_value}
                    onChange={(event) => updateDraft("sake_meter_value", event.target.value)}
                    placeholder="+1"
                  />
                </label>
                <label>
                  도수
                  <input
                    value={draft.abv}
                    onChange={(event) => updateDraft("abv", event.target.value)}
                    placeholder="15%"
                  />
                </label>
                <label>
                  용량
                  <input
                    value={draft.volume}
                    onChange={(event) => updateDraft("volume", event.target.value)}
                    placeholder="720ml"
                  />
                </label>
                <label>
                  가격
                  <input
                    value={draft.price}
                    onChange={(event) => updateDraft("price", event.target.value)}
                    placeholder="3000 yen"
                  />
                </label>
              </div>
            </section>

            <section className="sake-section">
              <h3>다시 마실까?</h3>
              <div className="segmented-control three-up">
                {DRINK_AGAIN_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={draft.drink_again === option.value ? "is-active" : ""}
                    onClick={() =>
                      updateDraft(
                        "drink_again",
                        draft.drink_again === option.value ? null : option.value,
                      )
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="sake-section">
              <h3>평가</h3>
              <div className="rating-stack">
                {RATING_GROUPS.map((group) => (
                  <div key={group.key} className="rating-row">
                    <span>{group.label}</span>
                    <div className={`segmented-control ${group.options.length === 5 ? "five-up" : "three-up"}`}>
                      {group.options.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={draft[group.key] === option.value ? "is-active" : ""}
                          onClick={() =>
                            updateDraft(
                              group.key,
                              draft[group.key] === option.value ? null : option.value,
                            )
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <label className="note-field sake-section">
              <span>한줄 메모</span>
              <textarea
                value={draft.one_line_note}
                onChange={(event) => updateDraft("one_line_note", event.target.value)}
                placeholder="오늘 마신 느낌을 한 줄로 남겨보세요."
                rows={3}
              />
            </label>

            <section className="sake-section">
              <h3>특성 태그</h3>
              <div className="tag-groups">
                {TAG_GROUPS.map((group) => {
                  const groupTags = tags.filter((tag) => tag.tag_group === group.value);
                  return (
                    <div key={group.value} className="tag-group">
                      <span>{group.label}</span>
                      <div className="tag-chip-row">
                        {groupTags.map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            className={selectedTagIds.has(tag.id) ? "is-selected" : ""}
                            onClick={() => toggleTag(tag.id)}
                          >
                            {tag.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="add-chip"
                          onClick={() =>
                            setActiveTagInput((current) =>
                              current === group.value ? null : group.value,
                            )
                          }
                          aria-label={`${group.label} 추가`}
                        >
                          +
                        </button>
                      </div>
                      {activeTagInput === group.value ? (
                        <form
                          className="tag-inline-form"
                          onBlur={(event) => {
                            const nextFocusedElement = event.relatedTarget;
                            if (
                              nextFocusedElement instanceof Node &&
                              event.currentTarget.contains(nextFocusedElement)
                            ) {
                              return;
                            }

                            setActiveTagInput(null);
                            setTagInputs((current) => ({
                              ...current,
                              [group.value]: "",
                            }));
                          }}
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleAddTag(group.value);
                          }}
                        >
                          <input
                            value={tagInputs[group.value]}
                            onChange={(event) =>
                              setTagInputs((current) => ({
                                ...current,
                                [group.value]: event.target.value.slice(0, 20),
                              }))
                            }
                            placeholder="새 태그"
                            maxLength={20}
                            autoFocus
                          />
                          <button type="submit" disabled={!tagInputs[group.value].trim()}>
                            추가
                          </button>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="sake-section">
              <h3>외부 정보</h3>
              <div className="input-grid sake-context-grid">
                <label>
                  장소
                  <input
                    value={draft.place}
                    onChange={(event) => updateDraft("place", event.target.value)}
                    placeholder="이자카야"
                  />
                </label>
                <label>
                  날짜
                  <input
                    type="date"
                    value={draft.consumed_date}
                    onChange={(event) => updateDraft("consumed_date", event.target.value)}
                  />
                </label>
                <label>
                  동행
                  <input
                    value={draft.companions}
                    onChange={(event) => updateDraft("companions", event.target.value)}
                    placeholder="친구"
                  />
                </label>
                <label>
                  안주
                  <input
                    value={draft.food_pairing}
                    onChange={(event) => updateDraft("food_pairing", event.target.value)}
                    placeholder="사시미"
                  />
                </label>
              </div>
            </section>

            {route.page === "edit" ? (
              <button
                type="button"
                className="ghost-button full-width"
                onClick={() => handleNavigate({ page: "detail", id: route.id })}
              >
                수정 취소
              </button>
            ) : null}

            <button
              type="button"
              className="save-button"
              onClick={() => void handleSave()}
              disabled={isSaving || !canSave}
            >
              {isSaving ? "저장 중..." : route.page === "edit" ? "수정 저장" : "기록 저장"}
            </button>
            {statusMessage ? <p className="status-message">{statusMessage}</p> : null}
          </section>
        ) : null}
      </main>
    );
  }

  function renderList() {
    if (needsCloudLogin) {
      return renderCloudRequired();
    }

    return (
      <main className="single-column">
        <section className="panel list-panel">
          <div className="panel-header">
            <div>
              <p className="kicker">Archive</p>
              <h2>저장된 사케 기록</h2>
            </div>
            <span className="badge">
              {filteredRecords.length}
              {searchQuery.trim() ? `/${records.length}` : ""}개
            </span>
          </div>

          <div className="list-toolbar">
            <label className="search-field">
              <span className="sr-only">사케 기록 검색</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="이름, 지역, 양조장, 태그, 장소, 동행, 안주, 메모 검색"
              />
            </label>
          </div>

          {isLoading ? <p className="empty-copy">불러오는 중...</p> : null}
          {!isLoading && records.length === 0 ? (
            <p className="empty-copy">아직 저장된 기록이 없습니다. 먼저 한 잔을 기록해 보세요.</p>
          ) : null}
          {!isLoading && records.length > 0 && filteredRecords.length === 0 ? (
            <p className="empty-copy">검색 결과가 없습니다.</p>
          ) : null}

          <div className="log-list">
            {filteredRecords.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="log-card log-card-button"
                onClick={() => handleNavigate({ page: "detail", id: String(entry.id) })}
              >
                <div className="log-thumbnail" aria-hidden="true">
                  {entry.images[0]?.thumbnail_data_url || entry.images[0]?.data_url ? (
                    <img
                      src={entry.images[0].thumbnail_data_url ?? entry.images[0].data_url}
                      alt=""
                    />
                  ) : (
                    <span>酒</span>
                  )}
                </div>
                <div className="log-card-content">
                  <div className="log-card-main">
                    <div>
                      <strong>{entry.record.name}</strong>
                      <p>{getEntrySubtitle(entry)}</p>
                    </div>
                    <span>{formatInputDate(entry.record.consumed_date)}</span>
                  </div>
                  <div className="log-card-meta">
                    <span>{getDrinkAgainLabel(entry.record.drink_again)}</span>
                    {entry.record.place ? <span>{entry.record.place}</span> : null}
                    <span>{entry.record.one_line_note || "메모 없음"}</span>
                  </div>
                  {getPrimaryTags(entry).length > 0 ? (
                    <div className="log-flavor-chips sake-tag-chips">
                      {getPrimaryTags(entry).map((tag) => (
                        <span key={tag.id}>{tag.label}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  function renderDetail() {
    if (needsCloudLogin) {
      return renderCloudRequired();
    }

    const record = selectedEntry?.record;
    const basicInfoRows = record
      ? [
          { label: "지역", value: formatOptional(record.region) },
          { label: "양조장", value: formatOptional(record.brewery) },
          { label: "쌀", value: formatOptional(record.rice) },
          { label: "종류", value: formatOptional(record.sake_type) },
          { label: "일본주도", value: formatOptional(record.sake_meter_value) },
          { label: "도수", value: formatOptional(record.abv) },
          { label: "용량", value: formatOptional(record.volume) },
          { label: "가격", value: formatOptional(record.price) },
        ]
      : [];
    const contextRows = record
      ? [
          { label: "장소", value: formatOptional(record.place) },
          { label: "날짜", value: formatInputDate(record.consumed_date) },
          { label: "동행", value: formatOptional(record.companions) },
          { label: "안주", value: formatOptional(record.food_pairing) },
        ]
      : [];

    return (
      <main className="single-column">
        <section className="panel detail-panel sake-detail">
          {isLoading ? <p className="empty-copy">불러오는 중...</p> : null}
          {!isLoading && !selectedEntry ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="kicker">Detail</p>
                  <h2>기록을 찾을 수 없습니다</h2>
                </div>
              </div>
              <button type="button" className="save-button" onClick={() => handleNavigate({ page: "logs" })}>
                목록으로 돌아가기
              </button>
            </>
          ) : null}

          {!isLoading && selectedEntry ? (
            <>
              <div className="detail-photo-collage">
                {selectedEntry.images.length > 0 ? (
                  selectedEntry.images.map((image) => (
                    <button
                      key={image.id}
                      type="button"
                      className="detail-slide"
                      onClick={() =>
                        setActiveImage({
                          id: image.id,
                          data_url: image.data_url,
                          thumbnail_data_url: image.thumbnail_data_url ?? undefined,
                          mime_type: image.mime_type,
                          file_name: image.file_name,
                          display_order: image.display_order,
                        })
                      }
                    >
                      <img src={image.data_url} alt={image.file_name} />
                    </button>
                  ))
                ) : (
                  <div className="detail-photo-placeholder">
                    <span>酒</span>
                  </div>
                )}
              </div>

              <div className="detail-title-row">
                <div>
                  <p className="kicker">Sake Note</p>
                  <h2>{selectedEntry.record.name}</h2>
                  <p className="detail-subtitle">
                    {getEntrySubtitle(selectedEntry)} · {formatInputDate(selectedEntry.record.consumed_date)}
                  </p>
                </div>
              </div>

              <section className="detail-block">
                <h3>다시 마실까?</h3>
                <p className="drink-again-value">
                  {getDrinkAgainLabel(selectedEntry.record.drink_again)}
                </p>
              </section>

              <section className="detail-block">
                <h3>평가 요약</h3>
                <div className="sake-rating-summary">
                  <span>달콤/드라이 · {getRatingLabel(selectedEntry.record.sweet_dry, SWEET_DRY_OPTIONS)}</span>
                  <span>향 · {getRatingLabel(selectedEntry.record.aroma_intensity, AROMA_INTENSITY_OPTIONS)}</span>
                  <span>산미 · {getRatingLabel(selectedEntry.record.acidity, ACIDITY_OPTIONS)}</span>
                  <span>깔끔/감칠 · {getRatingLabel(selectedEntry.record.clean_umami, CLEAN_UMAMI_OPTIONS)}</span>
                </div>
              </section>

              <div className="detail-note">
                <h3>한줄 메모</h3>
                <p>{selectedEntry.record.one_line_note || "남긴 메모가 없습니다."}</p>
              </div>

              <section className="detail-block">
                <h3>특성 태그</h3>
                <div className="log-flavor-chips sake-tag-chips detail-tags">
                  {selectedEntry.tags.length > 0 ? (
                    selectedEntry.tags.map((tag) => <span key={tag.id}>{tag.label}</span>)
                  ) : (
                    <em>선택한 태그가 없습니다.</em>
                  )}
                </div>
              </section>

              <section className="detail-block">
                <h3>기본 정보</h3>
                <dl className="detail-info-grid">
                  {basicInfoRows.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="detail-block">
                <h3>외부 정보</h3>
                <dl className="detail-info-grid">
                  {contextRows.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <div className="detail-actions detail-actions-bottom">
                <button type="button" className="ghost-button" onClick={() => handleNavigate({ page: "logs" })}>
                  목록
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => handleNavigate({ page: "edit", id: String(selectedEntry.id) })}
                >
                  수정
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void handleDeleteRecord(selectedEntry.id)}
                  disabled={isDeleting}
                >
                  {isDeleting ? "삭제 중..." : "삭제"}
                </button>
              </div>
            </>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Sake Journal</p>
          <h1>
            <button
              type="button"
              className="title-link"
              onClick={() => handleNavigate({ page: "logs" })}
            >
              Sake Log
            </button>
          </h1>
          <p className="hero-copy">사진, 맛의 방향, 다시 마실 의향을 빠르게 남기는 사케 기록장입니다.</p>
        </div>
        <nav className="top-nav" aria-label="Primary">
          <div className="auth-status">
            {auth.status === "authenticated" ? (
              <>
                {auth.user.avatarUrl ? <img src={auth.user.avatarUrl} alt="" /> : null}
                <span>{auth.user.displayName ?? auth.user.email ?? "Google 사용자"} · Cloud sync</span>
              </>
            ) : isLocalMode ? (
              <span>로컬 모드</span>
            ) : isAutoMode ? (
              <span>{auth.status === "loading" ? "로그인 확인 중" : "자동 모드 · 로컬 저장"}</span>
            ) : (
              <span>{auth.status === "loading" ? "로그인 확인 중" : "클라우드 로그인 필요"}</span>
            )}
          </div>
          <button
            type="button"
            className={route.page === "compose" ? "is-active" : ""}
            onClick={() => handleNavigate({ page: "compose" })}
          >
            새 기록
          </button>
          <button
            type="button"
            className={route.page !== "compose" ? "is-active" : ""}
            onClick={() => handleNavigate({ page: "logs" })}
          >
            기록 목록
          </button>
          {auth.status === "authenticated" ? (
            <button type="button" onClick={() => void handleLogout()}>
              로그아웃
            </button>
          ) : (
            <button type="button" onClick={handleLogin}>
              Google 로그인
            </button>
          )}
        </nav>
      </header>

      {statusMessage && route.page !== "compose" && route.page !== "edit" ? (
        <p className="status-message global-status">{statusMessage}</p>
      ) : null}

      {route.page === "compose" || route.page === "edit" ? renderComposer() : null}
      {route.page === "logs" ? renderList() : null}
      {route.page === "detail" ? renderDetail() : null}

      {activeImage ? (
        <div
          className="image-modal"
          role="dialog"
          aria-modal="true"
          aria-label={activeImage.file_name}
          onClick={() => setActiveImage(null)}
        >
          <button
            type="button"
            className="image-modal-close"
            onClick={() => setActiveImage(null)}
          >
            Close
          </button>
          <img src={activeImage.data_url} alt={activeImage.file_name} />
        </div>
      ) : null}
    </div>
  );
}

export default App;

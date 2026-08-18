import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { DEFAULT_SAKE_TAGS } from "./constants/defaultTags";
import {
  createCustomSakeTag,
  deleteSakeRecord,
  fileToDataUrl,
  fileToThumbnailDataUrl,
  loadSakeRecords,
  loadSakeTags,
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

interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface AuthSessionState {
  checked: boolean;
  authenticated: boolean;
  user: AuthUser | null;
}

const INITIAL_AUTH_STATE: AuthSessionState = {
  checked: false,
  authenticated: false,
  user: null,
};

function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createEmptyDraft(): SakeDraft {
  return {
    name: "",
    region: "",
    brewery: "",
    rice: "",
    sake_type: "",
    sake_meter_value: "",
    abv: "",
    volume: "",
    price: "",
    drink_again: null,
    sweet_dry: null,
    aroma_intensity: null,
    acidity: null,
    clean_umami: null,
    one_line_note: "",
    selected_tag_ids: [],
    place: "",
    consumed_date: getTodayString(),
    companions: "",
    food_pairing: "",
    images: [],
  };
}

function createDraftFromEntry(entry: SakeRecordEntry): SakeDraft {
  const { record, images, record_tags } = entry;
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
    selected_tag_ids: record_tags.map((rt) => rt.tag_id),
    place: record.place ?? "",
    consumed_date: record.consumed_date,
    companions: record.companions ?? "",
    food_pairing: record.food_pairing ?? "",
    images: images.map((img) => ({
      id: img.id,
      data_url: img.data_url,
      thumbnail_data_url: img.thumbnail_data_url ?? undefined,
      file_name: img.file_name,
      mime_type: img.mime_type,
      display_order: img.display_order,
    })),
  };
}

export default function App() {
  const [authSession, setAuthSession] = useState<AuthSessionState>(INITIAL_AUTH_STATE);
  const [route, setRoute] = useState<string>(() => window.location.hash || "#/");
  const [records, setRecords] = useState<SakeRecordEntry[]>([]);
  const [tags, setTags] = useState<SakeTag[]>([]);
  const [draft, setDraft] = useState<SakeDraft>(createEmptyDraft);
  const [editingId, setEditingId] = useState<number | string | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number>(0);
  const [detailPhotoIndex, setDetailPhotoIndex] = useState<number>(0);
  const [lightboxOpen, setLightboxOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [filterDrinkAgain, setFilterDrinkAgain] = useState<DrinkAgainValue | "all">("all");
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isStorageCloud = import.meta.env.VITE_STORAGE_MODE === "cloud";
  const isStaticSite =
    typeof window !== "undefined" &&
    (window.location.hostname.endsWith("github.io") ||
      window.location.hostname.includes("gitlab.io"));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 1. Check auth session on load
  const checkAuthSession = async () => {
    // If hosted on GitHub Pages or static host, directly activate IndexedDB local mode
    if (isStaticSite) {
      setAuthSession({ checked: true, authenticated: false, user: null });
      setCloudStorageEnabled(false);
      return;
    }

    try {
      const res = await fetch(`/api/me?_=${Date.now()}`, {
        cache: "no-store",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          setAuthSession({ checked: true, authenticated: true, user: data.user });
          setCloudStorageEnabled(true);
          return;
        }
      }
    } catch {
      // ignore
    }
    setAuthSession({ checked: true, authenticated: false, user: null });
    setCloudStorageEnabled(false);
  };

  useEffect(() => {
    checkAuthSession();
  }, []);

  const scrollPositions = useRef<Record<string, number>>({});
  const currentRouteRef = useRef<string>(window.location.hash || "#/");

  // 2. Hash Route listener with smart scroll restoration
  useEffect(() => {
    const handleHashChange = () => {
      const prevRoute = currentRouteRef.current;
      const newRoute = window.location.hash || "#/";

      // Save scroll position of the previous route
      scrollPositions.current[prevRoute] = window.scrollY;
      currentRouteRef.current = newRoute;

      setRoute(newRoute);

      // Detail view or Create view -> Always scroll to top
      if (newRoute.startsWith("#/logs/") || newRoute === "#/") {
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (newRoute === "#/logs") {
        // Returning to gallery list -> Restore previous scroll position
        const savedY = scrollPositions.current["#/logs"];
        if (typeof savedY === "number") {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.scrollTo({ top: savedY, behavior: "instant" });
            });
          });
        } else {
          window.scrollTo({ top: 0, behavior: "instant" });
        }
      } else {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // 3. Load records and tags when authenticated or in local mode
  const refreshData = async () => {
    try {
      setIsLoadingData(true);
      const [fetchedRecords, fetchedTags] = await Promise.all([
        loadSakeRecords(authSession.user?.id ?? "local"),
        loadSakeTags(authSession.user?.id ?? "local"),
      ]);
      setRecords(fetchedRecords);
      setTags(fetchedTags);
    } catch (e) {
      console.error("Failed to load records/tags:", e);
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    if (authSession.checked) {
      if (authSession.authenticated || !isStorageCloud || isStaticSite) {
        refreshData();
      } else {
        setIsLoadingData(false);
      }
    }
  }, [authSession.checked, authSession.authenticated]);

  // Handle image uploads
  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const newImages: SakeDraftImage[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const [dataUrl, thumbUrl] = await Promise.all([
          fileToDataUrl(file),
          fileToThumbnailDataUrl(file),
        ]);
        newImages.push({
          id: crypto.randomUUID(),
          data_url: dataUrl,
          thumbnail_data_url: thumbUrl,
          file_name: file.name,
          mime_type: file.type || "image/jpeg",
          display_order: draft.images.length + newImages.length,
        });
      }

      setDraft((prev) => ({
        ...prev,
        images: [...prev.images, ...newImages],
      }));
      setSelectedPhotoIndex(0);
      showToast(`${files.length}장의 사진이 추가되었습니다.`);
    } catch (error) {
      alert("사진을 처리하는 도중 오류가 발생했습니다.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const removePhoto = (photoId: number | string) => {
    setDraft((prev) => {
      const filtered = prev.images.filter((img) => img.id !== photoId);
      const reordered = filtered.map((img, idx) => ({ ...img, display_order: idx }));
      return { ...prev, images: reordered };
    });
    setSelectedPhotoIndex(0);
  };

  // Toggle characteristic tag
  const toggleTag = (tagId: number | string) => {
    setDraft((prev) => {
      const exists = prev.selected_tag_ids.includes(tagId);
      const nextIds = exists
        ? prev.selected_tag_ids.filter((id) => id !== tagId)
        : [...prev.selected_tag_ids, tagId];
      return { ...prev, selected_tag_ids: nextIds };
    });
  };

  // Add custom tag
  const handleAddCustomTag = async (group: SakeTagGroup) => {
    const groupName = group === "taste" ? "맛" : group === "aroma" ? "향" : "느낌";
    const label = window.prompt(`새로운 [${groupName}] 특성 태그를 입력하세요 (최대 20자):`);
    if (!label || !label.trim()) return;

    try {
      const newTag = await createCustomSakeTag(group, label, authSession.user?.id ?? "local");
      if (newTag) {
        setTags((prev) => (prev.some((t) => t.id === newTag.id) ? prev : [...prev, newTag]));
        setDraft((prev) => ({
          ...prev,
          selected_tag_ids: Array.from(new Set([...prev.selected_tag_ids, newTag.id])),
        }));
        showToast(`'${newTag.label}' 태그가 추가되었습니다.`);
      }
    } catch (e) {
      alert("태그 추가에 실패했습니다.");
    }
  };

  // Submit Sake Record
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      alert("술 이름은 필수 항목입니다.");
      return;
    }

    setIsSubmitting(true);
    try {
      let targetId: number | string | null = null;
      if (editingId) {
        const updated = await updateSakeRecord(editingId, draft, authSession.user?.id ?? "local");
        targetId = updated?.id ?? editingId;
        showToast("사케 기록이 성공적으로 수정되었습니다.");
      } else {
        const created = await saveSakeRecord(draft, authSession.user?.id ?? "local");
        targetId = created?.id ?? null;
        showToast("정갈한 사케 기록이 저장되었습니다.");
      }

      await refreshData();
      setDraft(createEmptyDraft());
      setEditingId(null);

      if (targetId) {
        window.location.hash = `#/logs/${targetId}`;
      } else {
        window.location.hash = "#/logs";
      }
    } catch (error) {
      console.error("Save failed:", error);
      alert("기록 저장 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Sake Record
  const handleDelete = async (id: number | string) => {
    if (!window.confirm("이 사케 테이스팅 기록을 정말 삭제하시겠습니까?")) {
      return;
    }

    try {
      await deleteSakeRecord(id, authSession.user?.id ?? "local");
      showToast("기록이 삭제되었습니다.");
      await refreshData();
      window.location.hash = "#/logs";
    } catch {
      alert("기록 삭제에 실패했습니다.");
    }
  };

  // Route matching
  const isCreateRoute = route === "#/" || route === "";
  const isListRoute = route === "#/logs";
  const isDetailRoute = route.startsWith("#/logs/") && !route.endsWith("/edit");
  const isEditRoute = route.startsWith("#/logs/") && route.endsWith("/edit");

  // Detail item extraction
  const detailId = isDetailRoute ? route.replace("#/logs/", "") : null;
  const detailIndex = detailId ? records.findIndex((r) => String(r.id) === detailId) : -1;
  const detailRecord = detailIndex !== -1 ? records[detailIndex] : null;
  const prevRecord = detailIndex > 0 ? records[detailIndex - 1] : null;
  const nextRecord = detailIndex >= 0 && detailIndex < records.length - 1 ? records[detailIndex + 1] : null;

  // Edit item setup
  useEffect(() => {
    if (isEditRoute) {
      const editId = route.replace("#/logs/", "").replace("/edit", "");
      const target = records.find((r) => String(r.id) === editId);
      if (target) {
        setEditingId(target.id);
        setDraft(createDraftFromEntry(target));
        setSelectedPhotoIndex(0);
      }
    } else if (isCreateRoute && editingId !== null) {
      setEditingId(null);
      setDraft(createEmptyDraft());
      setSelectedPhotoIndex(0);
    }
  }, [route, isEditRoute, isCreateRoute, records]);

  // ----------------------------------------------------
  // RENDER 0: Initial Session Checking Loader
  // ----------------------------------------------------
  if (!authSession.checked) {
    return (
      <div className="app-container">
        <div className="zen-splash-loader">
          <div className="zen-splash-logo">酒</div>
          <div className="zen-splash-text">사케 테이스팅 저널을 준비하는 중...</div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // RENDER 1: Anonymous Zen Minimal Landing View
  // ----------------------------------------------------
  if (authSession.checked && isStorageCloud && !isStaticSite && !authSession.authenticated) {
    return (
      <div className="zen-landing-shell">
        <div className="zen-emblem-wrap">
          <div className="zen-emblem-box">
            <span className="zen-emblem-kanji">酒</span>
          </div>
        </div>

        <div className="zen-brand-subtitle">SAKE TASTING JOURNAL</div>
        <h1 className="zen-hero-title">
          오늘 밤의 한 잔,<br />가장 정갈하게 기록하세요
        </h1>
        <p className="zen-hero-desc">
          술 이름과 사진, 다시 마실 의향을 1분 만에 남기는<br />나만의 사케 시음 아카이브
        </p>

        <div className="zen-keyword-row">
          <span className="zen-keyword-pill">✦ 1분 간편 기록</span>
          <span className="zen-keyword-pill">✦ 라벨 갤러리</span>
          <span className="zen-keyword-pill">✦ 클라우드 안전 보관</span>
        </div>

        <div className="zen-login-card">
          <a href="/api/auth/google/login" className="btn-google-login">
            <svg viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Google 계정으로 시작하기
          </a>
          <span className="zen-helper-text">별도 가입 절차 없이 안전하게 동기화됩니다.</span>
        </div>
      </div>
    );
  }

  // Tags categorized
  const allTags = tags.length > 0 ? tags : DEFAULT_SAKE_TAGS;
  const tasteTags = allTags.filter((t) => t.tag_group === "taste");
  const aromaTags = allTags.filter((t) => t.tag_group === "aroma");
  const moodTags = allTags.filter((t) => t.tag_group === "mood");

  // Active hero photo URL for write view
  const currentHeroPhotoUrl =
    draft.images[selectedPhotoIndex]?.data_url ||
    draft.images[0]?.data_url ||
    "";

  // ----------------------------------------------------
  // RENDER 2: Main Authenticated App View
  // ----------------------------------------------------
  return (
    <div className="app-container">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="feedback-toast">
          <span>✨</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header & User Profile */}
      <header className="top-bar">
        <a href="#/" className="brand-title">
          <span className="kanji-logo">酒</span> SAKE LOG
        </a>
        <div className="header-right">
          {authSession.authenticated && authSession.user && (
            <div className="user-profile-widget" title={authSession.user.email ?? ""}>
              {authSession.user.avatarUrl ? (
                <img src={authSession.user.avatarUrl} className="user-avatar-img" alt="Avatar" />
              ) : (
                <div className="user-avatar-fallback">
                  {authSession.user.displayName?.[0] || "U"}
                </div>
              )}
              <span className="user-name-text">
                {authSession.user.displayName || authSession.user.email || "사용자"}
              </span>
            </div>
          )}
          {authSession.authenticated && (
            <button
              className="btn-header-logout"
              onClick={() => {
                window.location.href = "/api/auth/logout?returnTo=/";
              }}
            >
              로그아웃
            </button>
          )}
        </div>
      </header>

      {/* View Switcher Tabs */}
      <div className="view-switcher-wrapper">
        <nav className="view-switcher">
          <a
            href="#/"
            className={`view-tab ${isCreateRoute || isEditRoute ? "active" : ""}`}
            onClick={() => {
              if (editingId) {
                setEditingId(null);
                setDraft(createEmptyDraft());
              }
            }}
          >
            {editingId ? "기록 수정" : "기록 작성"}
          </a>
          <a href="#/logs" className={`view-tab ${isListRoute || isDetailRoute ? "active" : ""}`}>
            컬렉션 갤러리 {!isLoadingData && `(${records.length})`}
          </a>
        </nav>
      </div>

      {/* ====================================================
           1. WRITE / EDIT VIEW (SEAMLESS JOURNAL SHEET)
      ==================================================== */}
      {(isCreateRoute || isEditRoute) && (
        <form onSubmit={handleSubmit}>
          <div className="desktop-sheet-split">
            {/* LEFT: Multi Photo Gallery & High Priority Verdict */}
            <div className="sticky-photo-col">
              <div className="journal-sheet" style={{ padding: "18px" }}>
                {/* Photo Canvas */}
                <div className="photo-hero-wrapper">
                  {currentHeroPhotoUrl ? (
                    <>
                      <span className="photo-hero-badge">
                        {selectedPhotoIndex === 0 ? "★ 대표 이미지" : `사진 ${selectedPhotoIndex + 1}`}
                      </span>
                      <img src={currentHeroPhotoUrl} alt="Sake Hero" />
                    </>
                  ) : (
                    <div
                      className="photo-hero-placeholder"
                      style={{ cursor: "pointer" }}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <span style={{ fontSize: "2rem" }}>📷</span>
                      <span>사케 사진을 등록해보세요</span>
                    </div>
                  )}
                </div>

                {/* Photo Thumbnails Strip */}
                <div className="photo-strip">
                  {draft.images.map((img, idx) => (
                    <div
                      key={img.id}
                      className={`photo-thumb ${idx === selectedPhotoIndex ? "active" : ""}`}
                      onClick={() => setSelectedPhotoIndex(idx)}
                    >
                      <img src={img.thumbnail_data_url || img.data_url} alt={`Thumb ${idx + 1}`} />
                      <button
                        type="button"
                        className="photo-thumb-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          removePhoto(img.id);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="photo-btn-add"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span>+</span>
                    <span>추가</span>
                  </button>
                </div>

                <input
                  type="file"
                  id={fileInputId}
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  accept="image/*"
                  multiple
                  onChange={handlePhotoUpload}
                />

                {/* 3. Drink Again (High Priority Verdict) */}
                <div style={{ marginTop: "20px" }}>
                  <div className="section-heading" style={{ marginBottom: "8px" }}>
                    다시 마실까?
                  </div>
                  <div className="segmented-choice-bar">
                    {(
                      [
                        { val: "no", label: "별로" },
                        { val: "unsure", label: "잘모르겠음" },
                        { val: "yes", label: "다시 마신다" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.val}
                        type="button"
                        className={`segmented-choice-btn ${draft.drink_again === opt.val ? "active" : ""}`}
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            drink_again: prev.drink_again === opt.val ? null : opt.val,
                          }))
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: Seamless Journal Sheet Specs & Tastings */}
            <div className="journal-sheet">
              {/* 2. Basic Info */}
              <div className="sheet-section">
                <input
                  type="text"
                  className="hero-name-input"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="술 이름을 입력하세요 *"
                  required
                />

                <div className="inline-spec-grid">
                  <div className="spec-field-group">
                    <span className="spec-field-label">지역</span>
                    <input
                      type="text"
                      className="spec-field-input"
                      value={draft.region}
                      onChange={(e) => setDraft({ ...draft, region: e.target.value })}
                      placeholder="예: 야마구치현"
                    />
                  </div>
                  <div className="spec-field-group">
                    <span className="spec-field-label">양조장</span>
                    <input
                      type="text"
                      className="spec-field-input"
                      value={draft.brewery}
                      onChange={(e) => setDraft({ ...draft, brewery: e.target.value })}
                      placeholder="예: 아사히주조"
                    />
                  </div>
                  <div className="spec-field-group">
                    <span className="spec-field-label">쌀 / 정미율</span>
                    <input
                      type="text"
                      className="spec-field-input"
                      value={draft.rice}
                      onChange={(e) => setDraft({ ...draft, rice: e.target.value })}
                      placeholder="예: 야마다니시키 (23%)"
                    />
                  </div>
                  <div className="spec-field-group">
                    <span className="spec-field-label">종류</span>
                    <input
                      type="text"
                      className="spec-field-input"
                      value={draft.sake_type}
                      onChange={(e) => setDraft({ ...draft, sake_type: e.target.value })}
                      placeholder="예: 준마이다이긴죠"
                    />
                  </div>
                  <div className="spec-field-group">
                    <span className="spec-field-label">일본주도</span>
                    <input
                      type="text"
                      className="spec-field-input"
                      value={draft.sake_meter_value}
                      onChange={(e) => setDraft({ ...draft, sake_meter_value: e.target.value })}
                      placeholder="예: +1, -2"
                    />
                  </div>
                  <div className="spec-field-group">
                    <span className="spec-field-label">도수</span>
                    <input
                      type="text"
                      className="spec-field-input"
                      value={draft.abv}
                      onChange={(e) => setDraft({ ...draft, abv: e.target.value })}
                      placeholder="예: 15%"
                    />
                  </div>
                  <div className="spec-field-group">
                    <span className="spec-field-label">용량</span>
                    <input
                      type="text"
                      className="spec-field-input"
                      value={draft.volume}
                      onChange={(e) => setDraft({ ...draft, volume: e.target.value })}
                      placeholder="예: 720ml"
                    />
                  </div>
                  <div className="spec-field-group">
                    <span className="spec-field-label">가격</span>
                    <input
                      type="text"
                      className="spec-field-input"
                      value={draft.price}
                      onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                      placeholder="예: 5,000 엔"
                    />
                  </div>
                </div>
              </div>

              {/* 4. Ratings (Stepped Pill Tracks) */}
              <div className="sheet-section">
                <div className="section-heading">평가</div>

                {/* Sweet - Dry (5-Step) */}
                <div className="rating-item-row">
                  <div className="rating-item-header">
                    <span className="rating-item-title">달콤함 — 드라이함</span>
                    <span className="rating-item-val">
                      {draft.sweet_dry === 1 && "아주 달콤함 (1)"}
                      {draft.sweet_dry === 2 && "달콤함 (2)"}
                      {draft.sweet_dry === 3 && "보통 (3)"}
                      {draft.sweet_dry === 4 && "드라이함 (4)"}
                      {draft.sweet_dry === 5 && "아주 드라이함 (5)"}
                    </span>
                  </div>
                  <div className="rating-pill-track">
                    {(
                      [
                        { val: 1, label: "아주달콤" },
                        { val: 2, label: "달콤" },
                        { val: 3, label: "보통" },
                        { val: 4, label: "드라이" },
                        { val: 5, label: "아주드라이" },
                      ] as const
                    ).map((step) => (
                      <button
                        key={step.val}
                        type="button"
                        className={`rating-pill-step ${draft.sweet_dry === step.val ? "active" : ""}`}
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            sweet_dry: prev.sweet_dry === step.val ? null : (step.val as SweetDryValue),
                          }))
                        }
                      >
                        {step.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Subtle - Vibrant Aroma (3-Step) */}
                <div className="rating-item-row">
                  <div className="rating-item-header">
                    <span className="rating-item-title">은은함 — 화려함</span>
                    <span className="rating-item-val">
                      {draft.aroma_intensity === 1 && "은은한향 (1)"}
                      {draft.aroma_intensity === 2 && "보통 (2)"}
                      {draft.aroma_intensity === 3 && "화려한향 (3)"}
                    </span>
                  </div>
                  <div className="rating-pill-track">
                    {(
                      [
                        { val: 1, label: "은은한향" },
                        { val: 2, label: "보통" },
                        { val: 3, label: "화려한향" },
                      ] as const
                    ).map((step) => (
                      <button
                        key={step.val}
                        type="button"
                        className={`rating-pill-step ${draft.aroma_intensity === step.val ? "active" : ""}`}
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            aroma_intensity:
                              prev.aroma_intensity === step.val
                                ? null
                                : (step.val as ThreeStepRatingValue),
                          }))
                        }
                      >
                        {step.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Acidity (3-Step) */}
                <div className="rating-item-row">
                  <div className="rating-item-header">
                    <span className="rating-item-title">산미</span>
                    <span className="rating-item-val">
                      {draft.acidity === 1 && "산미없음 (1)"}
                      {draft.acidity === 2 && "산미보통 (2)"}
                      {draft.acidity === 3 && "산미높음 (3)"}
                    </span>
                  </div>
                  <div className="rating-pill-track">
                    {(
                      [
                        { val: 1, label: "산미없음" },
                        { val: 2, label: "산미보통" },
                        { val: 3, label: "산미높음" },
                      ] as const
                    ).map((step) => (
                      <button
                        key={step.val}
                        type="button"
                        className={`rating-pill-step ${draft.acidity === step.val ? "active" : ""}`}
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            acidity:
                              prev.acidity === step.val
                                ? null
                                : (step.val as ThreeStepRatingValue),
                          }))
                        }
                      >
                        {step.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Clean - Umami (3-Step) */}
                <div className="rating-item-row">
                  <div className="rating-item-header">
                    <span className="rating-item-title">깔끔함 — 감칠맛</span>
                    <span className="rating-item-val">
                      {draft.clean_umami === 1 && "깔끔함 (1)"}
                      {draft.clean_umami === 2 && "보통 (2)"}
                      {draft.clean_umami === 3 && "감칠맛좋은 (3)"}
                    </span>
                  </div>
                  <div className="rating-pill-track">
                    {(
                      [
                        { val: 1, label: "깔끔함" },
                        { val: 2, label: "보통" },
                        { val: 3, label: "감칠맛좋은" },
                      ] as const
                    ).map((step) => (
                      <button
                        key={step.val}
                        type="button"
                        className={`rating-pill-step ${draft.clean_umami === step.val ? "active" : ""}`}
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            clean_umami:
                              prev.clean_umami === step.val
                                ? null
                                : (step.val as ThreeStepRatingValue),
                          }))
                        }
                      >
                        {step.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 5. One Line Note */}
              <div className="sheet-section">
                <div className="section-heading">한줄 메모</div>
                <textarea
                  className="quote-note-input"
                  rows={2}
                  value={draft.one_line_note}
                  onChange={(e) => setDraft({ ...draft, one_line_note: e.target.value })}
                  placeholder="오늘 마신 느낌을 한 줄로 남겨보세요."
                />
              </div>

              {/* 6. Characteristics Tags (All Expanded Flow) */}
              <div className="sheet-section">
                <div className="section-heading">특성 태그</div>

                {/* Taste Group */}
                <div className="tag-category-block">
                  <div className="tag-category-lead">
                    <span className="tag-lead-name">맛 Taste</span>
                  </div>
                  <div className="tag-chip-flow">
                    {tasteTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        className={`chip-item ${draft.selected_tag_ids.includes(tag.id) ? "active" : ""}`}
                        onClick={() => toggleTag(tag.id)}
                      >
                        {tag.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="chip-item btn-add-tag"
                      onClick={() => handleAddCustomTag("taste")}
                    >
                      + 직접입력
                    </button>
                  </div>
                </div>

                {/* Aroma Group */}
                <div className="tag-category-block">
                  <div className="tag-category-lead">
                    <span className="tag-lead-name">향 Aroma</span>
                  </div>
                  <div className="tag-chip-flow">
                    {aromaTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        className={`chip-item ${draft.selected_tag_ids.includes(tag.id) ? "active" : ""}`}
                        onClick={() => toggleTag(tag.id)}
                      >
                        {tag.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="chip-item btn-add-tag"
                      onClick={() => handleAddCustomTag("aroma")}
                    >
                      + 직접입력
                    </button>
                  </div>
                </div>

                {/* Mood Group */}
                <div className="tag-category-block">
                  <div className="tag-category-lead">
                    <span className="tag-lead-name">느낌 Mood</span>
                  </div>
                  <div className="tag-chip-flow">
                    {moodTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        className={`chip-item ${draft.selected_tag_ids.includes(tag.id) ? "active" : ""}`}
                        onClick={() => toggleTag(tag.id)}
                      >
                        {tag.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="chip-item btn-add-tag"
                      onClick={() => handleAddCustomTag("mood")}
                    >
                      + 직접입력
                    </button>
                  </div>
                </div>
              </div>

              {/* 7. Context (External Info) */}
              <div className="sheet-section">
                <div className="section-heading">외부 정보</div>
                <div className="inline-spec-grid">
                  <div className="spec-field-group">
                    <span className="spec-field-label">장소</span>
                    <input
                      type="text"
                      className="spec-field-input"
                      value={draft.place}
                      onChange={(e) => setDraft({ ...draft, place: e.target.value })}
                      placeholder="마신 장소"
                    />
                  </div>
                  <div className="spec-field-group">
                    <span className="spec-field-label">날짜</span>
                    <input
                      type="date"
                      className="spec-field-input"
                      value={draft.consumed_date}
                      onChange={(e) => setDraft({ ...draft, consumed_date: e.target.value })}
                    />
                  </div>
                  <div className="spec-field-group">
                    <span className="spec-field-label">안주</span>
                    <input
                      type="text"
                      className="spec-field-input"
                      value={draft.food_pairing}
                      onChange={(e) => setDraft({ ...draft, food_pairing: e.target.value })}
                      placeholder="함께 곁들인 음식"
                    />
                  </div>
                  <div className="spec-field-group">
                    <span className="spec-field-label">동행</span>
                    <input
                      type="text"
                      className="spec-field-input"
                      value={draft.companions}
                      onChange={(e) => setDraft({ ...draft, companions: e.target.value })}
                      placeholder="함께 마신 사람"
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
                <button type="submit" className="btn-submit-action" disabled={isSubmitting} style={{ flex: 1 }}>
                  {isSubmitting
                    ? "저장하는 중..."
                    : editingId
                      ? "수정 완료하기"
                      : "사케 기록 저장하기"}
                </button>
                {editingId && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setEditingId(null);
                      setDraft(createEmptyDraft());
                      window.location.hash = `#/logs/${editingId}`;
                    }}
                    style={{ padding: "0 20px" }}
                  >
                    취소
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      )}

      {/* ====================================================
           2. DETAIL VIEW
      ==================================================== */}
      {isDetailRoute && (
        <>
          {isLoadingData && !detailRecord ? (
            <div className="desktop-detail-grid">
              <div className="journal-sheet" style={{ margin: 0, padding: "18px" }}>
                <div className="skeleton-box" style={{ width: "100%", height: "400px", borderRadius: "var(--radius-md)" }} />
              </div>
              <div className="journal-sheet" style={{ margin: 0 }}>
                <div className="skeleton-box" style={{ height: "34px", width: "65%", marginBottom: "12px" }} />
                <div className="skeleton-box" style={{ height: "16px", width: "40%", marginBottom: "20px" }} />
                <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
                  <div className="skeleton-box" style={{ height: "24px", width: "90px", borderRadius: "9999px" }} />
                  <div className="skeleton-box" style={{ height: "24px", width: "70px", borderRadius: "9999px" }} />
                  <div className="skeleton-box" style={{ height: "24px", width: "70px", borderRadius: "9999px" }} />
                </div>
                <div className="skeleton-box" style={{ height: "68px", width: "100%", marginBottom: "20px" }} />
                <div className="skeleton-box" style={{ height: "90px", width: "100%", marginBottom: "20px" }} />
                <div className="skeleton-box" style={{ height: "140px", width: "100%" }} />
              </div>
            </div>
          ) : detailRecord ? (
            <div className="desktop-detail-grid">
              {/* Detail Left: Photo & Multi Thumbs (Framed in Journal Sheet) */}
              <div className="journal-sheet sticky-detail-photo" style={{ margin: 0, padding: "18px" }}>
                {detailRecord.images.length > 0 ? (
                  <>
                    <div
                      className="detail-hero-img-wrap"
                      onClick={() => setLightboxOpen(true)}
                      title="사진 클릭하여 크게 보기"
                    >
                      <span className="detail-photo-badge">
                        {detailPhotoIndex === 0
                          ? "★ 대표 사진"
                          : `사진 ${detailPhotoIndex + 1} / ${detailRecord.images.length}`}
                      </span>
                      <img
                        src={
                          detailRecord.images[detailPhotoIndex]?.data_url ||
                          detailRecord.images[0]?.data_url
                        }
                        className="detail-hero-img"
                        alt={detailRecord.record.name}
                      />
                      <div className="detail-zoom-hint">
                        <span>🔍</span>
                        <span>크게 보기</span>
                      </div>
                    </div>
                    {detailRecord.images.length > 1 && (
                      <div className="detail-thumb-strip">
                        {detailRecord.images.map((img, idx) => (
                          <img
                            key={img.id}
                            src={img.thumbnail_data_url || img.data_url}
                            className={`detail-thumb-item ${idx === detailPhotoIndex ? "active" : ""}`}
                            alt={`Thumb ${idx + 1}`}
                            onClick={() => setDetailPhotoIndex(idx)}
                          />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div
                    className="photo-hero-wrapper"
                    style={{ height: "300px", background: "var(--bg-subtle)" }}
                  >
                    <span style={{ fontSize: "2rem" }}>🍶</span>
                  </div>
                )}
              </div>

              {/* Detail Right: Content & Specs */}
              <div className="journal-sheet" style={{ margin: 0 }}>
                <div className="detail-title">{detailRecord.record.name}</div>
                <div className="detail-meta-line">
                  {[detailRecord.record.region, detailRecord.record.brewery, detailRecord.record.sake_type]
                    .filter(Boolean)
                    .join(" · ") || "기본 정보 미입력"}
                </div>

                {/* Evaluation Verdict & Scale Pills */}
                <div className="detail-pill-row">
                  {detailRecord.record.drink_again === "yes" && (
                    <span className="mini-pill gold">✨ 다시 마신다</span>
                  )}
                  {detailRecord.record.drink_again === "unsure" && (
                    <span className="mini-pill">🤔 잘모르겠음</span>
                  )}
                  {detailRecord.record.drink_again === "no" && (
                    <span className="mini-pill">💧 별로</span>
                  )}

                  {detailRecord.record.sweet_dry && (
                    <span className="mini-pill">
                      {detailRecord.record.sweet_dry === 1 && "아주 달콤함"}
                      {detailRecord.record.sweet_dry === 2 && "달콤함"}
                      {detailRecord.record.sweet_dry === 3 && "보통단맛"}
                      {detailRecord.record.sweet_dry === 4 && "드라이함"}
                      {detailRecord.record.sweet_dry === 5 && "아주 드라이함"}
                    </span>
                  )}

                  {detailRecord.record.aroma_intensity && (
                    <span className="mini-pill">
                      {detailRecord.record.aroma_intensity === 1 && "은은한향"}
                      {detailRecord.record.aroma_intensity === 2 && "보통향"}
                      {detailRecord.record.aroma_intensity === 3 && "화려한향"}
                    </span>
                  )}

                  {detailRecord.record.acidity && (
                    <span className="mini-pill">
                      {detailRecord.record.acidity === 1 && "산미없음"}
                      {detailRecord.record.acidity === 2 && "산미보통"}
                      {detailRecord.record.acidity === 3 && "산미높음"}
                    </span>
                  )}

                  {detailRecord.record.clean_umami && (
                    <span className="mini-pill">
                      {detailRecord.record.clean_umami === 1 && "깔끔함"}
                      {detailRecord.record.clean_umami === 2 && "보통"}
                      {detailRecord.record.clean_umami === 3 && "감칠맛좋은"}
                    </span>
                  )}
                </div>

                {/* Note */}
                {detailRecord.record.one_line_note && (
                  <div className="detail-quote">“{detailRecord.record.one_line_note}”</div>
                )}

                {/* Grouped Characteristic Tags (Taste, Aroma, Mood) */}
                {detailRecord.tags.length > 0 && (
                  <div className="detail-tags-section">
                    {detailRecord.tags.some((t) => t.tag_group === "taste") && (
                      <div className="detail-tag-group-row">
                        <span className="detail-tag-group-label">맛 Taste</span>
                        <div className="detail-tag-group-chips">
                          {detailRecord.tags
                            .filter((t) => t.tag_group === "taste")
                            .map((t) => (
                              <span key={t.id} className="chip-item active">
                                {t.label.replace(/^맛:\s*/, "")}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}

                    {detailRecord.tags.some((t) => t.tag_group === "aroma") && (
                      <div className="detail-tag-group-row">
                        <span className="detail-tag-group-label">향 Aroma</span>
                        <div className="detail-tag-group-chips">
                          {detailRecord.tags
                            .filter((t) => t.tag_group === "aroma")
                            .map((t) => (
                              <span key={t.id} className="chip-item active">
                                {t.label.replace(/^향:\s*/, "")}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}

                    {detailRecord.tags.some((t) => t.tag_group === "mood") && (
                      <div className="detail-tag-group-row">
                        <span className="detail-tag-group-label">느낌 Mood</span>
                        <div className="detail-tag-group-chips">
                          {detailRecord.tags
                            .filter((t) => t.tag_group === "mood")
                            .map((t) => (
                              <span key={t.id} className="chip-item active">
                                {t.label.replace(/^느낌:\s*/, "")}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Table Specs */}
                <table className="detail-specs-table">
                  <tbody>
                    {detailRecord.record.rice && (
                      <tr>
                        <td className="label">원료미/정미율</td>
                        <td className="val">{detailRecord.record.rice}</td>
                      </tr>
                    )}
                    {detailRecord.record.sake_meter_value && (
                      <tr>
                        <td className="label">일본주도</td>
                        <td className="val">{detailRecord.record.sake_meter_value}</td>
                      </tr>
                    )}
                    {detailRecord.record.abv && (
                      <tr>
                        <td className="label">도수</td>
                        <td className="val">{detailRecord.record.abv}</td>
                      </tr>
                    )}
                    {detailRecord.record.volume && (
                      <tr>
                        <td className="label">용량</td>
                        <td className="val">{detailRecord.record.volume}</td>
                      </tr>
                    )}
                    {detailRecord.record.price && (
                      <tr>
                        <td className="label">가격</td>
                        <td className="val">{detailRecord.record.price}</td>
                      </tr>
                    )}
                    {detailRecord.record.place && (
                      <tr>
                        <td className="label">장소</td>
                        <td className="val">{detailRecord.record.place}</td>
                      </tr>
                    )}
                    {detailRecord.record.food_pairing && (
                      <tr>
                        <td className="label">페어링 안주</td>
                        <td className="val">{detailRecord.record.food_pairing}</td>
                      </tr>
                    )}
                    {detailRecord.record.companions && (
                      <tr>
                        <td className="label">동행</td>
                        <td className="val">{detailRecord.record.companions}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="label">시음 일자</td>
                      <td className="val">{detailRecord.record.consumed_date}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Actions */}
                <div className="detail-actions-row">
                  <a href={`#/logs/${detailRecord.id}/edit`} className="btn-secondary">
                    수정하기
                  </a>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => handleDelete(detailRecord.id)}
                  >
                    삭제하기
                  </button>
                </div>

                {/* Journal Flip Previous / Next Navigation */}
                {records.length > 1 && (
                  <div className="journal-flip-nav">
                    {prevRecord ? (
                      <a href={`#/logs/${prevRecord.id}`} className="journal-flip-card prev">
                        <span className="flip-badge">‹ 이전 사케</span>
                        <span className="flip-name">{prevRecord.record.name}</span>
                      </a>
                    ) : (
                      <div className="journal-flip-card disabled">
                        <span className="flip-badge">‹ 이전 사케</span>
                        <span className="flip-name">첫 번째 기록</span>
                      </div>
                    )}

                    <a href="#/logs" className="journal-flip-card list" title="전체 갤러리 목록으로">
                      <span className="flip-badge">목록</span>
                      <span className="flip-name">전체 갤러리</span>
                    </a>

                    {nextRecord ? (
                      <a href={`#/logs/${nextRecord.id}`} className="journal-flip-card next">
                        <span className="flip-badge">다음 사케 ›</span>
                        <span className="flip-name">{nextRecord.record.name}</span>
                      </a>
                    ) : (
                      <div className="journal-flip-card disabled">
                        <span className="flip-badge">다음 사케 ›</span>
                        <span className="flip-name">마지막 기록</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state-box">
              <div className="empty-state-icon">🔍</div>
              <div className="empty-state-title">기록을 찾을 수 없습니다</div>
              <p className="empty-state-desc">해당 사케 기록이 삭제되었거나 존재하지 않습니다.</p>
              <a href="#/logs" className="btn-submit-action" style={{ maxWidth: "200px", margin: "0 auto" }}>
                목록으로 돌아가기
              </a>
            </div>
          )}
        </>
      )}

      {/* ====================================================
           3. COLLECTION LIST / GRID VIEW
      ==================================================== */}
      {isListRoute && (
        <>
          {/* Quick Verdict Taste Filter Bar */}
          {!isLoadingData && records.length > 0 && (
            <div className="gallery-filter-bar">
              <button
                type="button"
                className={`gallery-filter-pill ${filterDrinkAgain === "all" ? "active" : ""}`}
                onClick={() => setFilterDrinkAgain("all")}
              >
                전체 <span className="pill-count">{records.length}</span>
              </button>
              <button
                type="button"
                className={`gallery-filter-pill gold ${filterDrinkAgain === "yes" ? "active" : ""}`}
                onClick={() => setFilterDrinkAgain("yes")}
              >
                ✨ 다시 마신다 <span className="pill-count">{records.filter((r) => r.record.drink_again === "yes").length}</span>
              </button>
              <button
                type="button"
                className={`gallery-filter-pill ${filterDrinkAgain === "unsure" ? "active" : ""}`}
                onClick={() => setFilterDrinkAgain("unsure")}
              >
                🤔 잘모르겠음 <span className="pill-count">{records.filter((r) => r.record.drink_again === "unsure").length}</span>
              </button>
              <button
                type="button"
                className={`gallery-filter-pill ${filterDrinkAgain === "no" ? "active" : ""}`}
                onClick={() => setFilterDrinkAgain("no")}
              >
                💧 별로 <span className="pill-count">{records.filter((r) => r.record.drink_again === "no").length}</span>
              </button>
            </div>
          )}

          {isLoadingData ? (
            <div className="desktop-gallery-3col">
              {[1, 2, 3].map((n) => (
                <div key={n} className="skeleton-card">
                  <div className="skeleton-box skeleton-card-img" />
                  <div className="skeleton-card-body">
                    <div className="skeleton-box" style={{ height: "20px", width: "70%" }} />
                    <div className="skeleton-box" style={{ height: "14px", width: "45%" }} />
                    <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                      <div className="skeleton-box" style={{ height: "18px", width: "60px", borderRadius: "9999px" }} />
                      <div className="skeleton-box" style={{ height: "18px", width: "45px", borderRadius: "9999px" }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : records.length === 0 ? (
            <div className="empty-state-box">
              <div className="empty-state-icon">🍶</div>
              <div className="empty-state-title">아직 기록된 사케가 없습니다</div>
              <p className="empty-state-desc">
                오늘 마신 사케의 첫 번째 테이스팅 노트를 남겨보세요.
              </p>
              <a
                href="#/"
                className="btn-submit-action"
                style={{
                  display: "inline-block",
                  maxWidth: "240px",
                  textDecoration: "none",
                  textAlign: "center",
                }}
              >
                첫 사케 기록하기
              </a>
            </div>
          ) : (() => {
            const displayRecords =
              filterDrinkAgain === "all"
                ? records
                : records.filter((r) => r.record.drink_again === filterDrinkAgain);

            if (displayRecords.length === 0) {
              return (
                <div className="empty-state-box">
                  <div className="empty-state-icon">🏷️</div>
                  <div className="empty-state-title">선택한 조건의 사케 기록이 없습니다</div>
                  <p className="empty-state-desc">
                    {filterDrinkAgain === "yes" && "아직 '다시 마신다'로 기록된 인생 사케가 없습니다."}
                    {filterDrinkAgain === "unsure" && "'잘모르겠음'으로 기록된 사케가 없습니다."}
                    {filterDrinkAgain === "no" && "'별로'로 기록된 사케가 없습니다."}
                  </p>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setFilterDrinkAgain("all")}
                    style={{ margin: "0 auto", padding: "8px 24px" }}
                  >
                    전체 사케 목록 보기
                  </button>
                </div>
              );
            }

            return (
              <div className="desktop-gallery-3col">
                {displayRecords.map((entry) => {
                  const thumb =
                    entry.images[0]?.thumbnail_data_url ||
                    entry.images[0]?.data_url ||
                    "";
                  return (
                    <a
                      key={entry.id}
                      href={`#/logs/${entry.id}`}
                      className="collection-card"
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          className="collection-card-img"
                          alt={entry.record.name}
                        />
                      ) : (
                        <div
                          className="collection-card-img"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "2rem",
                          }}
                        >
                          🍶
                        </div>
                      )}
                      <div className="collection-card-body">
                        <div>
                          <div className="collection-title">{entry.record.name}</div>
                          <div className="collection-sub">
                            {[entry.record.region, entry.record.consumed_date]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                        <div className="collection-badges">
                          {entry.record.drink_again === "yes" && (
                            <span className="mini-pill gold">✨ 다시 마신다</span>
                          )}
                          {entry.tags.slice(0, 3).map((t) => (
                            <span key={t.id} className="mini-pill">
                              {t.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </a>
                  );
                })}

                {/* Ghost Slot for Adding Next Sake Record */}
                <a href="#/" className="collection-card-add">
                  <div className="collection-card-add-icon">+</div>
                  <div className="collection-card-add-text">새로운 사케 기록하기</div>
                </a>
              </div>
            );
          })()}
        </>
      )}

      {/* Lightbox Modal (High-Res Zoom View) */}
      {lightboxOpen && detailRecord && detailRecord.images.length > 0 && (
        <div className="lightbox-overlay" onClick={() => setLightboxOpen(false)}>
          <div className="lightbox-dialog" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="lightbox-close-btn"
              onClick={() => setLightboxOpen(false)}
              title="닫기 (ESC)"
            >
              ✕
            </button>

            {detailRecord.images.length > 1 && (
              <>
                <button
                  type="button"
                  className="lightbox-nav-btn prev"
                  onClick={() =>
                    setDetailPhotoIndex((prev) =>
                      prev > 0 ? prev - 1 : detailRecord.images.length - 1
                    )
                  }
                  title="이전 사진"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="lightbox-nav-btn next"
                  onClick={() =>
                    setDetailPhotoIndex((prev) =>
                      prev < detailRecord.images.length - 1 ? prev + 1 : 0
                    )
                  }
                  title="다음 사진"
                >
                  ›
                </button>
              </>
            )}

            <img
              src={
                detailRecord.images[detailPhotoIndex]?.data_url ||
                detailRecord.images[0]?.data_url
              }
              className="lightbox-main-img"
              alt={detailRecord.record.name}
            />

            {detailRecord.images.length > 1 && (
              <div className="lightbox-counter">
                {detailPhotoIndex + 1} / {detailRecord.images.length}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

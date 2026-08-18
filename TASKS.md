# TASKS.md — 사케 테이스팅 로그 작업 현황 및 백로그

이 문서는 Sake Log 프로젝트의 현재 마일스톤, 진행 상태, 향후 백로그를 관리하는 **살아있는 진행 상황 및 백로그(Living Backlog)** 문서이다.

과거 Phase 0부터 Phase 13까지의 세부 리빌드 및 마이그레이션 완료 이력은 [docs/archive/TASKS_PHASE_0_TO_13.md](docs/archive/TASKS_PHASE_0_TO_13.md)에 보관되어 있다.

---

## 🚀 기반 구축 및 마이그레이션 완료 요약 (Phase 0 ~ 13)

* [x] **사케 전용 도메인 & UI 완성**: 술 이름 중심 작성, 4개 평가 축, 3-Way 재음용 선택, 특성 태그 칩 그룹 및 커스텀 태그 지원.
* [x] **Cloud-first 아키텍처 구축**: Cloudflare D1(SQLite), Cloudflare R2(이미지 및 썸네일 WebP), Google OAuth 세션 격리.
* [x] **Mold Native 백엔드 연동 & 세션 브릿지**: `resources/*.yaml` 스키마 기반 REST API 구축 및 외부 세션 브릿지 미들웨어(`functions/api/[[path]].ts`)를 통한 안정적인 세션 주입 체계 확립.
* [x] **코드베이스 경량화 & 타입 무결성**: 미사용 레거시 컴포넌트/데이터 정리, `@cloudflare/workers-types` 연동을 통한 백엔드/프론트엔드 전체 타입체크 0 에러 달성.
* [x] **문서 체계 현대화**: `CONTEXT.md`(단일 진실 공급원), `AGENTS.md`(AI 지침), `README.md` 정비 및 CI 워크플로우 최적화.

---

## 📌 현재 마일스톤 현황

### 마일스톤 1: 웜 리넨 미니멀 디자인 시스템 & 반응형 UI 전면 리뉴얼 (완료)
- [x] **Warm Linen Light 디자인 토큰 수립**: 불필요한 다크 모드를 배제하고 정갈한 미색 화지/리넨 톤과 앤틱 골드/인디고 포인트로 일원화
- [x] **Seamless Journal Sheet 작성 폼**: 7개 카드 박스 난립을 걷어내고 유려한 단일 시트 캔버스 위에 언더라인 인풋, 3단 캡슐 토글, 스텝 필 트랙 적용
- [x] **다중 사진 갤러리**: Hero 대표 뷰 + 썸네일 스트립 + 간편 추가/삭제 인터랙션
- [x] **올-익스팬디드 특성 태그 플로우**: 탭 은닉 없이 맛/향/느낌 3단 행을 한눈에 보면서도 군더더기 없는 린넨 칩 플로우 구현
- [x] **PC / 모바일 완벽 반응형**: 데스크톱(2-Column Split 스티키 뷰 & 3열 매거진 그리드) 및 모바일(컴팩트 1열) 완벽 지원
- [x] **제로-레코드 Zen 미니멀 랜딩 뷰**: 단 한 화면에서 본질을 전달하는 비로그인 Google 시작 뷰 구현

### 마일스톤 2: 모바일 실사용 QA 및 Mold 피드백 정리 (완료)
- [x] **모바일 브라우저 터치 인터랙션 & 여백 리디자인**: 젠 랜딩 뷰 모바일 100dvh 센터링 및 시원한 패딩 적용
- [x] **브랜딩 및 파비콘 현대화**: 레거시 위스키 아이콘 ➔ 단아한 Warm Linen `酒` 파비콘 및 애플 터치 아이콘 적용
- [x] **배포 번들 클린업**: `*-preview.html` 개발용 파일을 `previews/` 디렉터리로 격리하여 프로덕션 빌드 번들에서 원천 제외
- [x] **공식 문서 체계화**: `docs/DESIGN_GUIDE.md` 수립 및 `AGENTS.md`, `CONTEXT.md` 상호 참조 SSOT 지정
- [x] **Mold 프레임워크 개선 RFC 작성**: `../mold/docs/tasks/2026-08-19-drink-log-feedback-eager-loading-and-blob-streaming.md` 피드백 문서 등록

### 마일스톤 3: One-Shot Aggregate API 네트워크 통합 및 읽기/쓰기 성능 최적화 (구현 완료)
- [x] **Step 1: 게이트웨이 원샷 읽기 API (`GET /api/entries`)**
  - `functions/api/[[path]].ts`에 D1 `env.DB.batch()`를 이용한 단일 왕복(Single RTT) 쿼리 및 엣지 조립 핸들러 구현
  - `src/lib/storage.ts`의 `loadSakeRecords()`를 `GET /api/entries` 1회 호출로 전환하여 목록 로딩 4회 ➔ 1회 단축
- [x] **Step 2: 게이트웨이 원샷 쓰기 API (`POST /api/entries`)**
  - `functions/api/[[path]].ts`에 신규 사진 R2 바이너리 병렬 업로드 + D1 배치 트랜잭션 일괄 저장 핸들러 구현
  - `src/lib/storage.ts`의 `saveSakeRecord()`를 단 1회의 원자적(Atomic) 호출로 전환
- [x] **Step 3: 게이트웨이 원샷 수정/삭제 API (`PUT /api/entries/:id`, `DELETE /api/entries/:id`)**
  - `functions/api/[[path]].ts`에 기존 사진 키 보존 + D1 배치 갱신/삭제 핸들러 구현
  - `src/lib/storage.ts`의 `updateSakeRecord()` 및 `deleteSakeRecord()`를 원샷 호출로 전환
- [ ] **Step 4: 통합 검증 및 원격 배포**
  - 3대 검증(`typecheck`, `typecheck:functions`, `build`) 0 error 확인 및 프로덕션 배포

---

## 📋 향후 백로그 (Next Backlog)

### 🌟 "다시 마실까?" 핵심 시그널 기반 UX 고도화 (검토 예정)
- [ ] **갤러리 원터치 취향 필터 (Quick Filter)**:
  - 갤러리 상단에 미니멀한 4버튼 탭(`전체`, `✨ 다시 마신다`, `🤔 잘모르겠음`, `💧 별로`) 배치하여, 술자리에서 1초 만에 인생 사케만 모아볼 수 있는 원터치 필터링 지원.
- [ ] **컬렉션 카드 골드 인장 씰 (Gold Stamp Seal)**:
  - `다시 마신다 (yes)`로 기록된 사케 카드에 영롱한 앰버 골드 인장(`✨`)을 강조하여 갤러리 스크롤 시 직관적인 소장 가치 극대화.
- [ ] **헤더 프로필 취향 스냅샷 (Taste Snapshot)**:
  - 프로필 영역에 `🍶 12잔의 기록 · ✨ 인생 사케 8병` 형태의 단아한 한 줄 요약 노출로 기록 동기부여 제공.

### 💾 정적 호스팅 & 비클라우드 환경(IndexedDB) 동작 최적화 (검토 예정)
- [ ] **GitHub Pages 등 정적 호스팅 단독 모드 점검**:
  - Cloudflare 백엔드 API가 없는 정적 환경(`hitel00000.github.io/drink-log` 등)에서 `src/lib/storage.ts`의 IndexedDB 단독 저장소 폴백 동작 및 데이터 영속성 점검.
- [ ] **로컬 ➔ 클라우드 마이그레이션 도구 (선택)**:
  - 비로그인 IndexedDB 모드로 사용하던 로컬 데이터를 추후 Cloudflare 클라우드 계정 로그인 시 안전하게 병합/업로드하는 간이 동기화 플로우 검토.

### 🔍 기타 기능 백로그
다음 기능들은 사케 MVP의 단순함과 속도를 해치지 않는 선에서 사용자의 명시적 요청 시 순차적으로 검토한다:

- [ ] 라벨 OCR 및 자동 텍스트 추출 (필요 시)
- [ ] 태그 검색 강화 및 사용 횟수 기반 정렬/필터링
- [ ] 시음 통계 요약 (가장 많이 마신 사케 종류/지역, 선호하는 맛 프로필 등)
- [ ] 소셜/외부 공유용 단일 카드 뷰 또는 이미지 내보내기
- [ ] 기타 주류(위스키, 와인 등) 타입으로의 확장 (단, 현재 사케 UX와 완전히 분리된 탭 형태)

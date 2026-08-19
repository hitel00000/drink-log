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

### 마일스톤 3: One-Shot Aggregate API 네트워크 통합 및 읽기/쓰기 성능 최적화 (완료)
- [x] **Step 1: 게이트웨이 원샷 읽기 API (`GET /api/entries`)**
  - `functions/api/[[path]].ts`에 D1 `env.DB.batch()`를 이용한 단일 왕복(Single RTT) 쿼리 및 엣지 조립 핸들러 구현
  - `src/lib/storage.ts`의 `loadSakeRecords()`를 `GET /api/entries` 1회 호출로 전환하여 목록 로딩 4회 ➔ 1회 단축
- [x] **Step 2: 게이트웨이 원샷 쓰기 API (`POST /api/entries`)**
  - `functions/api/[[path]].ts`에 신규 사진 R2 바이너리 병렬 업로드 + D1 배치 트랜잭션 일괄 저장 핸들러 구현
  - `src/lib/storage.ts`의 `saveSakeRecord()`를 단 1회의 원자적(Atomic) 호출로 전환
- [x] **Step 3: 게이트웨이 원샷 수정/삭제 API (`PUT /api/entries/:id`, `DELETE /api/entries/:id`)**
  - `functions/api/[[path]].ts`에 기존 사진 키 보존 + D1 배치 갱신/삭제 핸들러 구현
  - `src/lib/storage.ts`의 `updateSakeRecord()` 및 `deleteSakeRecord()`를 원샷 호출로 전환
- [x] **Step 4: 통합 검증 및 원격 배포**
  - 3대 검증(`typecheck`, `typecheck:functions`, `build`) 0 error 확인 및 프로덕션 배포

### 마일스톤 4: 모바일 시음 저널 UX & 동선 고도화 (완료)
- [x] **기록 저장/수정 후 상세 뷰 자동 이동 (`Save & Redirect Flow`)**:
  - 작성/수정 완료 즉시 방금 기록한 사케 상세 뷰(`#/logs/:id`)로 이동하여 시음 노트 확인 및 만족도 극대화
  - 수정 모드 시 '취소' 버튼 추가로 안전한 원복 지원
- [x] **갤러리 원터치 취향 필터 탭 (`Quick Taste Filter`)**:
  - 갤러리 상단에 `[전체]`, `[✨ 다시 마신다]`, `[🤔 잘모르겠음]`, `[💧 별로]` 4단 필터 칩 배치 및 개수 실시간 노출
  - 술자리에서 1초 만에 인생 사케만 즉시 조회 가능
- [x] **컬렉션 카드 골드 인장 씰 (`Gold Stamp Seal`)**:
  - `다시 마신다 (yes)`로 기록된 사케 카드 우측 상단에 영롱한 앰버 골드 인장 뱃지(`✨`) 얹어 스크롤 시 직관적인 인생 사케 소장 가치 극대화
- [x] **실시간 간편 검색창 (`Quick Real-Time Search`)**:
  - 술 이름, 지역, 양조장, 쌀, 종류, 메모, 태그를 즉시 0.1초 만에 실시간 필터링
- [x] **상세 뷰 저널 플립 네비게이션 (`Journal Flip Prev/Next`)**:
  - 상세 뷰 하단에 이전/다음 사케의 실제 이름을 미리 보여주는 플립 카드 배치
  - 마치 시음 노트를 한 장씩 넘겨보는 듯한 정갈한 아날로그 경험 제공
- [x] **모바일 브라우저 크로스플랫폼 안정화 (iOS Safari Date Input Overflow 방어)**:
  - iOS WebKit의 네이티브 Date Picker 및 Grid Blowout(2열 트랙 팽창) 버그 방어를 위한 `repeat(2, minmax(0, 1fr))` 및 `-webkit-appearance: none;`, `::-webkit-date-and-time-value` 리셋 복원
- [x] **GitHub Pages 등 정적 호스팅 단독 모드 점검 (`Standalone IndexedDB`)**:
  - Cloudflare Pages Functions가 없는 순수 정적 호스팅 환경(GitHub Pages 등)에서도 로컬 IndexedDB 단독 모드로 매끄럽게 동작함을 실사용 검증 완료

### 마일스톤 5: Mold Native Phase 11 Eager Loading 읽기 파이프라인 전환 및 조회 최적화 (완료)
- [x] **Mold Phase 11 실서비스 연동 평가 및 피드백 문서화**:
  - `../mold/docs/tasks/2026-08-19-drink-log-feedback-phase-11-evaluation.md`에 Nested Update(`PUT`), Blob Storage 수명주기, M:N Eager Loading 제안 등록
- [x] **목록 조회 읽기 파이프라인의 Mold Native 전환 (`GET /api/sake_records?include=images,record_tags`)**:
  - `src/lib/storage.ts`의 `loadSakeRecords()`를 Mold Native Eager Loading으로 전환하여 레거시 4회 분할 fetch를 2회(사케 기록 Eager + 태그 마스터)로 최적화
- [x] **단일 사케 기록 조회 최적화 (`GET /api/sake_records/:id?include=images,record_tags`)**:
  - `getSakeRecordById()`에서 전체 목록 find 대신 Mold Native 단일 Eager Loading 엔드포인트를 직접 조회하도록 개선

### 마일스톤 6: Mold 피드백 완결 및 레거시 읽기 게이트웨이 핸들러 클린업 (완료)
- [x] **Mold 피드백 교환 및 BFF 하이브리드 아키텍처 결정**:
  - `pipe/mold-drinklog/`를 통해 Mold v2 제안 검토 및 모바일 실무 관점의 Edge BFF 하이브리드 아키텍처 확정 회신 (`2026-08-19-drinklog-to-mold-reply-v2.md`)
- [x] **백엔드 `handleEntriesGet` 레거시 조회 핸들러 제거 (`functions/api/[[path]].ts`)**:
  - Mold Native `GET /api/sake_records?include=images,record_tags`로 조회가 완전 일원화됨에 따라 불필요해진 메모리 조인 핸들러 및 라우트 제거 (~80줄 감축)
- [x] **프론트엔드 스토리지 에러 핸들링 정돈 (`src/lib/storage.ts`)**:
  - 불필요해진 `GET /api/entries` fallback 제거 및 Mold Native 읽기 파이프라인 정리
- [x] **3대 검증 (`typecheck`, `typecheck:functions`, `build`) 및 무결성 확인**:
  - 타입체크 및 프로덕션 빌드 0 error 검증 완료

### 마일스톤 7: 레거시 다단계 Fallback 및 수동 이미지 핸들러 전량 클린업 (완료)
- [x] **프론트엔드 비원자적 다단계 Fallback 전량 제거 (`src/lib/storage.ts`)**:
  - `saveSakeRecord`, `updateSakeRecord`, `deleteSakeRecord` 내부의 레거시 다단계 HTTP 호출 및 롤백 루프 제거 (~240줄 감축)
  - 미사용 경로 상수(`CLOUD_SAKE_IMAGES_PATH`, `CLOUD_RECORD_TAGS_PATH`) 정리
- [x] **백엔드 수동 이미지 프록시 핸들러 제거 (`functions/api/[[path]].ts` ➔ Mold Native Blob 전환)**:
  - 수동 `handleImages` (`GET /api/images?key=...`) 및 라우트를 완전 제거하고, Mold Native `GET /api/sake_images/:id/blob/image_key` 및 `thumbnail_key` 엔드포인트로 전환 (~43줄 추가 감축)
- [x] **독립 Codegen CLI 피드백 및 package.json 연동 완료**:
  - `pipe/mold-drinklog/2026-08-19-drinklog-to-mold-cli-codegen-friction.md` 등록 및 `npm run codegen` 스크립트 연동 완료
- [x] **3대 검증 (`typecheck`, `typecheck:functions`, `build`) 0 error 통과 및 번들 최적화 (192KB ➔ 188KB)**

---

## 📋 향후 백로그 및 유지 관리 정책 (Backlog & Maintenance Policy)

현재 사케 전용 테이스팅 저널의 핵심 기능, 웜 리넨 미니멀 디자인 시스템, Mold Native 읽기 최적화 및 안정적인 Edge BFF 쓰기 파이프라인이 100% 완비되었습니다. 

`AGENTS.md`의 최우선 원칙에 따라, 작고 단단한 모바일 기록 경험을 유지하기 위해 당분간 신규 기능 추가 없이 **실사용 안정성 및 유지보수**에 집중합니다.

### 🚫 제외/보류된 항목 (Dropped / Won't Do)
- ~~**비로그인 랜딩 페이지 샘플 저널 프리뷰**~~: 개인 전용 기록 앱이므로 불필요한 마케팅용 온보딩을 배제하고 현재의 단아한 젠(Zen) 로그인 뷰 유지.
- ~~**헤더 프로필 취향 스냅샷**~~: 모바일 헤더의 정갈한 여백과 줄바꿈 방지(1줄 유지)를 위해 군더더기 요약 텍스트 배제.
- ~~**로컬 ➔ 클라우드 마이그레이션 도구**~~: 단순하고 단단한 Cloud-first / Standalone 격리 원칙 유지를 위해 구현하지 않음.
- ~~**범용 주류 확장 / 복잡한 통계 대시보드 / AI 추천 / OCR**~~: `AGENTS.md` 규칙에 따라 사케 테이스팅 본질에 집중하기 위해 구현하지 않음.


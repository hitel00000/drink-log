# 사케 앱 리빌드 작업 이력 (Phase 0 ~ Phase 13 아카이브)

이 문서는 Phase 0부터 Phase 13까지 진행된 Sake Log 앱 리빌드, Cloudflare 연동, Mold Native 아키텍처 전환, 문서 체계 현대화 작업의 전체 완료 이력 아카이브이다.

---

## 리빌드 원칙

- 먼저 사케 MVP를 제대로 만든다. 범용 주류 앱 UI를 주 제품으로 유지하지 않는다.
- 데이터 모델에는 `drink_type = "sake"`를 남겨 나중에 확장할 여지를 둔다.
- MVP 작성 흐름이 안정된 뒤에는 Cloudflare API를 실제 제품 저장 경로로 본다.
- 로컬 전용 기능은 새로 늘리지 않는다.
- IndexedDB는 계속 쓸 경우에도 간단한 보조 용도로만 제한한다.
- 전문가형 시음 구조보다 간단한 선택값을 우선한다.
- 인증과 클라우드 데이터 freshness가 중요한 동안에는 service worker 캐싱을 다시 넣지 않는다.

---

## 완료된 Phase 요약 (Phase 0 ~ 7)

- [x] Phase 0: `PROJECT_SAKE_REVISED.md`를 현재 제품 기준 문서로 고정했고, 기존 범용 주류 앱 흐름은 교체 대상으로 정리했다.
- [x] Phase 1: 사케 중심 도메인 모델과 draft 기본값을 만들었다.
- [x] Phase 2: 사케용 로컬 store와 기본 태그, 커스텀 태그, 이미지 저장 구조를 만들었다. 기존 alcohol-log 기록은 자동 마이그레이션하지 않는다.
- [x] Phase 3: 작성 화면을 사진, 기본 정보, 다시 마실까, 평가, 한줄 메모, 태그, 외부 정보 순서로 리빌드했다.
- [x] Phase 4: 목록 화면을 사케 기록 기준 정보와 단순 검색 중심으로 리빌드했다.
- [x] Phase 5: 상세, 수정, 삭제 흐름을 사케 spec 순서에 맞춰 리빌드했다.
- [x] Phase 6: Cloudflare D1/R2 schema와 Pages Functions API를 사케 모델에 맞췄고, 사용자별 `owner_id` 경계를 적용했다.
- [x] Phase 7: `npm.cmd run typecheck`, `npm.cmd run typecheck:functions`, `npm.cmd run build`를 통과했고, dev server 없이 주요 수동 확인 항목을 점검했다.

---

## Phase 8 - Cloud-first 전환 경계 정리

- [x] 앱의 기준 저장소를 Cloudflare API로 고정한다.
- [x] 로컬 IndexedDB는 간단한 보조 용도로만 남긴다.
- [x] 로컬 전용 모드로만 가능한 사용자 기능은 새로 만들지 않는다.
- [x] UI에서 로컬 데이터와 클라우드 데이터가 섞여 보일 수 있는 지점을 찾는다.
- [x] 클라우드 기준으로 기록 목록, 상세, 작성, 수정, 삭제 흐름이 한 경로로 이어지게 정리한다.
- [x] `docs/local-cloudflare-mapping.md`가 더 이상 제품 기준 문서처럼 보이지 않게 현재 역할을 다시 설명한다.

Phase 8 완료 메모:
- 비로그인 상태에서 앱이 IndexedDB 사케 기록을 자동으로 읽거나 쓰지 않게 막았다.
- 작성, 목록, 상세, 수정, 삭제는 로그인된 Cloudflare API 경로에서만 동작한다.
- 로그아웃 또는 비로그인 상태에서는 기존 로컬 기록과 클라우드 기록이 섞여 보이지 않게 화면 상태를 비운다.

---

## Phase 9 - 로그인과 세션 UX 마감

- [x] 로그인하지 않은 사용자가 앱에 들어왔을 때의 첫 화면을 cloud-first 기준으로 점검한다.
- [x] `/api/me` 실패, 세션 만료, 로그아웃 직후 재진입 흐름을 확인한다.
- [x] `401`과 `403` 응답을 사용자가 이해할 수 있는 상태로 처리한다.
- [x] 모바일 Safari에서 로그아웃 후 뒤로가기, 새로고침, 재방문 흐름을 확인한다.
- [x] 인증이 필요한 이미지 업로드와 삭제 API가 비로그인 상태에서 막히는지 확인한다.

Phase 9 완료 메모:
- `VITE_STORAGE_MODE=cloud`에서는 비로그인 사용자가 로컬 기록 화면으로 섞이지 않고 Google 로그인 안내 화면을 보게 유지했다.
- 세션 만료로 `401`이 오면 앱 상태를 anonymous로 되돌리고 클라우드 기록/태그 상태를 비운다 (`clearCloudSessionState()`).

---

## Phase 10 - 운영 설정과 배포 체크리스트

- [x] D1 schema 적용 절차를 문서로 확인한다.
- [x] 기본 사케 태그 seed 절차를 문서로 확인한다.
- [x] R2 bucket과 이미지 경로 설정을 문서로 확인한다.
- [x] Google OAuth redirect URI와 Cloudflare Pages 배포 URL을 문서로 확인한다.
- [x] 운영에 필요한 환경 변수와 바인딩 이름을 한 곳에서 확인할 수 있게 정리한다.

Phase 10 완료 메모:
- `docs/operations-checklist.md`에 Cloudflare Pages 기준 운영 체크리스트를 추가했다.
- D1 schema 적용 명령 및 기본 사케 태그 seed 확인 query를 문서화했다.

---

## Phase 11 - 디버그와 운영 노출 정리

- [x] `/api/debug/storage` 같은 디버그 API를 유지할지, 보호할지, 제거할지 결정한다.
- [x] 운영 환경에서 노출되면 안 되는 세션, 사용자, storage 정보가 응답에 포함되지 않는지 확인한다.
- [x] 디버그 API를 남긴다면 인증된 사용자에게만 제한한다.

Phase 11 완료 메모:
- `/api/debug/storage`는 D1/R2와 UI 목록 불일치를 가르는 QA 도구로 유지하고 `401 authentication_required`로 보호했다.

---

## Phase 12 - API 세션 연동 정비, Functions 타입체크 통과 및 레거시 정리

- [x] `mold_app.ts`에서 Google OAuth 세션 쿠키(`alcohol_log_session`)와 `oauth_sessions` 테이블 연동.
- [x] `mold_app.ts` 내부 미선언 변수 `insertSql` 런타임/컴파일 에러 해결.
- [x] `@cloudflare/workers-types` 추가 및 `functions/` 전체 타입체크 통과 (`npm run typecheck:functions`).
- [x] 사케 MVP에 사용되지 않는 이전 위스키/주류 컴포넌트, 데이터 및 `storage.ts` 레거시 함수 정리.
- [x] `functions/api/[[path]].ts`에 Mold 세션 브릿지 미들웨어를 도입하여 생성 파일과의 결합도 분리.
- [x] `npm run typecheck`, `npm run typecheck:functions`, `npm run build` 전체 무결성 검증.

Phase 12 완료 메모:
- Google OAuth 로그인 상태에서 D1 REST API 호출 시 사용자 식별(`owner_id`) 및 권한 인가가 100% 정상 작동하도록 세션 검증 경로를 일원화했다.
- Functions 타입체크 0 에러를 달성하여 Cloudflare 배포 파이프라인의 타입 안정성을 확보했다.
- 미사용 레거시 파일 6개를 정리하고 `src/lib/storage.ts`를 사케 전용으로 경량화하여 번들 크기를 줄였다.

---

## Phase 13 - 문서 체계 현대화 및 지식 영속화

- [x] `CONTEXT.md`를 단일 진실 공급원(Single Source of Truth)으로 신규 수립.
- [x] `AGENTS.md`의 시점 문구(과거 5월 여행 등)를 일반화하고 Mold Native 제약 규칙 추가.
- [x] 기존 기획서(`PROJECT.md`, `PROJECT_SAKE_REVISED.md`)를 `docs/archive/`로 이동하여 아카이빙.
- [x] `README.md`를 현재 사케 MVP 및 검증 명령어로 최신화.
- [x] `.github/workflows/deploy.yml`에 `paths-ignore` 추가하여 불필요한 배포 방지.

Phase 13 완료 메모:
- 시스템 아키텍처, Mold Native 세션 브릿지, D1/R2 구성 및 데이터 모델을 `CONTEXT.md`에 일원화하여 영속화했다.
- AI 에이전트 작업 지침(`AGENTS.md`)의 판단 기준을 모바일 사케 테이스팅 경험 중심으로 갱신했다.
- 프로젝트 루트를 깔끔하게 정돈하고 개발/검증 진입점을 명확히 했다.

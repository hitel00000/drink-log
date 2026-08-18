# 사케 앱 리빌드 작업 목록

이 문서는 `PROJECT_SAKE_REVISED.md`를 기준으로 현재 Alcohol Log 앱을
사케 중심 기록 앱으로 다시 만드는 작업 목록이다.

제품 방향은 사케 시음 기록 앱으로 리셋한다. 사케 MVP의 기본 작성, 목록, 상세,
수정, 삭제 흐름은 한 차례 완성했으며, 다음 기준은 Cloudflare를 실제 저장소로
삼는 cloud-first 앱으로 정리하는 것이다.

기존에 만든 Cloudflare Pages, Google OAuth, `owner_id`, D1, R2 방향은 제품의
주 경로로 재사용한다. 로컬 모드는 정말 간단한 보조 용도로만 남기고, 로컬 전용
추가 기능은 붙이지 않는다.

## 리빌드 원칙

- 먼저 사케 MVP를 제대로 만든다. 범용 주류 앱 UI를 주 제품으로 유지하지 않는다.
- 데이터 모델에는 `drink_type = "sake"`를 남겨 나중에 확장할 여지를 둔다.
- MVP 작성 흐름이 안정된 뒤에는 Cloudflare API를 실제 제품 저장 경로로 본다.
- 로컬 전용 기능은 새로 늘리지 않는다.
- IndexedDB는 계속 쓸 경우에도 간단한 보조 용도로만 제한한다.
- 전문가형 시음 구조보다 간단한 선택값을 우선한다.
- 인증과 클라우드 데이터 freshness가 중요한 동안에는 service worker 캐싱을 다시
  넣지 않는다.

## 현재 작업 방향

- 사용자는 실제 QA를 진행하면서 앱을 써 보고 있다.
- Cloudflare 경로는 현재 QA 기준으로 큰 문제 없이 보인다.
- 앞으로의 작업은 새 기능 추가보다 cloud-first 기준으로 코드, 문서, 운영 경로를
  단순하게 만드는 데 둔다.
- 로컬 모드는 장기 제품 방향이 아니며, 간단한 보조 용도 외의 추가 기능은 붙이지 않는다.

## 완료된 Phase 요약

Phase 0-7은 사케 MVP 리빌드 완료 이력으로만 관리한다. 다음 작업을 고를 때는 아래
요약만 참고하고, 세부 체크리스트는 현재 작업 대상에서 제외한다.

- [x] Phase 0: `PROJECT_SAKE_REVISED.md`를 현재 제품 기준 문서로 고정했고,
      기존 범용 주류 앱 흐름은 교체 대상으로 정리했다.
- [x] Phase 1: 사케 중심 도메인 모델과 draft 기본값을 만들었다.
- [x] Phase 2: 사케용 로컬 store와 기본 태그, 커스텀 태그, 이미지 저장 구조를
      만들었다. 기존 alcohol-log 기록은 자동 마이그레이션하지 않는다.
- [x] Phase 3: 작성 화면을 사진, 기본 정보, 다시 마실까, 평가, 한줄 메모, 태그,
      외부 정보 순서로 리빌드했다.
- [x] Phase 4: 목록 화면을 사케 기록 기준 정보와 단순 검색 중심으로 리빌드했다.
- [x] Phase 5: 상세, 수정, 삭제 흐름을 사케 spec 순서에 맞춰 리빌드했다.
- [x] Phase 6: Cloudflare D1/R2 schema와 Pages Functions API를 사케 모델에
      맞췄고, 사용자별 `owner_id` 경계를 적용했다.
- [x] Phase 7: `npm.cmd run typecheck`, `npm.cmd run typecheck:functions`,
      `npm.cmd run build`를 통과했고, dev server 없이 주요 수동 확인 항목을 점검했다.

## Phase 8 - Cloud-first 전환 경계 정리

- [x] 앱의 기준 저장소를 Cloudflare API로 고정한다.
- [x] 로컬 IndexedDB는 간단한 보조 용도로만 남긴다.
- [x] 로컬 전용 모드로만 가능한 사용자 기능은 새로 만들지 않는다.
- [x] UI에서 로컬 데이터와 클라우드 데이터가 섞여 보일 수 있는 지점을 찾는다.
- [x] 클라우드 기준으로 기록 목록, 상세, 작성, 수정, 삭제 흐름이 한 경로로 이어지게
      정리한다.
- [x] `docs/local-cloudflare-mapping.md`가 더 이상 제품 기준 문서처럼 보이지 않게
      현재 역할을 다시 설명한다.

Phase 8 완료 메모:

- 비로그인 상태에서 앱이 IndexedDB 사케 기록을 자동으로 읽거나 쓰지 않게 막았다.
- 작성, 목록, 상세, 수정, 삭제는 로그인된 Cloudflare API 경로에서만 동작한다.
- 로그아웃 또는 비로그인 상태에서는 기존 로컬 기록과 클라우드 기록이 섞여 보이지 않게
  화면 상태를 비운다.
- 로컬 IndexedDB 코드는 제거하지 않고 보조 저장소와 개발용 fallback으로만 남겼다.
- `docs/local-cloudflare-mapping.md`, `docs/cloudflare-pages.md`, `README.md`에서
  cloud-first 기준과 로컬 문서의 현재 역할을 명확히 했다.

Phase 8 결정 기준:

- 사용자가 실제로 쓰는 제품 데이터는 Cloudflare D1/R2에 있어야 한다.
- IndexedDB는 남기더라도 제품의 주 저장소가 아니라 간단한 보조 장치로만 본다.
- 이 단계에서는 백업/export, 오프라인 모드, 로컬 전용 기능을 추가하지 않는다.

## Phase 9 - 로그인과 세션 UX 마감

- [x] 로그인하지 않은 사용자가 앱에 들어왔을 때의 첫 화면을 cloud-first 기준으로
      점검한다.
- [x] `/api/me` 실패, 세션 만료, 로그아웃 직후 재진입 흐름을 확인한다.
- [x] `401`과 `403` 응답을 사용자가 이해할 수 있는 상태로 처리한다.
- [x] 모바일 Safari에서 로그아웃 후 뒤로가기, 새로고침, 재방문 흐름을 확인한다.
- [x] 인증이 필요한 이미지 업로드와 삭제 API가 비로그인 상태에서 막히는지 확인한다.

Phase 9 완료 메모:

- `VITE_STORAGE_MODE=cloud`에서는 비로그인 사용자가 로컬 기록 화면으로 섞이지 않고
  Google 로그인 안내 화면을 보게 유지했다.
- `/api/me`는 `no-store`로 재확인하고, Safari back-forward cache 복원이나 탭 재진입
  시 로그인 상태를 다시 확인하게 했다.
- 클라우드 저장소 요청의 `401`, `403`, `404`를 구분해 사용자에게 세션 만료, 권한 없음,
  기록 없음 상태로 보여준다.
- 세션 만료로 `401`이 오면 앱 상태를 anonymous로 되돌리고 클라우드 기록/태그 상태를
  비운다. 이 정리 경로는 `clearCloudSessionState()`로 모아 누락 가능성을 줄였다.
- 로그아웃 버튼은 클라이언트 상태를 먼저 비운 뒤 서버 로그아웃 URL로 `replace`
  이동해 뒤로가기에서 이전 인증 UI가 복원될 가능성을 줄였다.
- 사케 record와 image API는 세션이 없으면 `401`, 다른 사용자의 record 또는 image에
  접근하면 `403`, 존재하지 않는 record/image는 `404`를 반환하도록 경계를 정리했다.

Phase 9 검증:

- `npm.cmd run typecheck`
- `npm.cmd run typecheck:functions`
- `npm.cmd run build`
- dev server는 실행하지 않았고, 모바일 Safari 항목은 코드 경로 기준으로 점검했다.

## Phase 10 - 운영 설정과 배포 체크리스트

- [x] D1 schema 적용 절차를 문서로 확인한다.
- [x] 기본 사케 태그 seed 절차를 문서로 확인한다.
- [x] R2 bucket과 이미지 경로 설정을 문서로 확인한다.
- [x] Google OAuth redirect URI와 Cloudflare Pages 배포 URL을 문서로 확인한다.
- [x] 운영에 필요한 환경 변수와 바인딩 이름을 한 곳에서 확인할 수 있게 정리한다.
- [x] Pages와 Workers 프로젝트가 섞여 보일 수 있는 지점을 문서에서 분명히 구분한다.

Phase 10 완료 메모:

- `docs/operations-checklist.md`에 Cloudflare Pages 기준 운영 체크리스트를 추가했다.
- D1 schema 적용 명령은 Windows PowerShell 기준 `npx.cmd wrangler d1 execute alcohol-log --remote --file=docs/schema.sql`로 정리했다.
- 기본 사케 태그 seed 확인 query와 기대 개수(taste 7, aroma 11, mood 4)를 문서화했다.
- R2 bucket/binding과 이미지 경로, Google OAuth redirect URI 예시, 운영 환경 변수,
  Pages/Workers 구분 기준을 한 문서에서 확인할 수 있게 했다.
- 운영 문서 정리 중 맛 태그와 평가 표현의 현재 기준이 `달콤함`임을 확인하고,
  관련 문서와 코드 표기를 같은 표현으로 정리했다.

## Phase 11 - 디버그와 운영 노출 정리

- [x] `/api/debug/storage` 같은 디버그 API를 유지할지, 보호할지, 제거할지 결정한다.
- [x] 운영 환경에서 노출되면 안 되는 세션, 사용자, storage 정보가 응답에 포함되지
      않는지 확인한다.
- [x] QA에 필요한 최소 디버그 도구와 운영에서 제거할 도구를 구분한다.
- [x] 디버그 API를 남긴다면 인증된 사용자에게만 제한한다.
- [x] service worker나 브라우저 캐시가 cloud 데이터 freshness를 해치지 않는지 다시
      확인한다.

Phase 11 완료 메모:

- `/api/debug/storage`는 D1/R2와 UI 목록 불일치를 가르는 QA 도구로 유지한다.
- 대신 unauthenticated 요청은 `401 authentication_required`로 제한하고, 응답에서
  email, display name, record name 같은 사용자 식별/콘텐츠 정보를 제거했다.
- 디버그 응답은 현재 사용자 기준 count와 최신 record의 최소 식별 정보만 반환한다.
- `docs/operations-checklist.md`에 운영에서 남길 디버그 도구와 제거해야 할 도구를
  구분했다.
- service worker는 새로 등록하지 않고, 기존 registration과 Cache Storage를
  best-effort로 정리하는 현재 코드 경로를 확인했다.

## Phase 12 - API 세션 연동 정비, Functions 타입체크 통과 및 레거시 정리

- [x] `mold_app.ts`에서 Google OAuth 세션 쿠키(`alcohol_log_session`)와 `oauth_sessions` 테이블 연동.
- [x] `mold_app.ts` 내부 미선언 변수 `insertSql` 런타임/컴파일 에러 해결.
- [x] `@cloudflare/workers-types` 추가 및 `functions/` 전체 타입체크 통과 (`npm run typecheck:functions`).
- [x] 사케 MVP에 사용되지 않는 이전 위스키/주류 컴포넌트, 데이터 및 `storage.ts` 레거시 함수 정리.
- [x] `npm run typecheck`, `npm run typecheck:functions`, `npm run build` 전체 무결성 검증.

Phase 12 완료 메모:

- Google OAuth 로그인 상태에서 D1 REST API 호출 시 사용자 식별(`owner_id`) 및 권한 인가가 100% 정상 작동하도록 세션 검증 경로를 일원화했다.
- Functions 타입체크 0 에러를 달성하여 Cloudflare 배포 파이프라인의 타입 안정성을 확보했다.
- 미사용 레거시 파일 6개를 정리하고 `src/lib/storage.ts`를 사케 전용으로 경량화하여 번들 크기를 줄였다.

## Phase 13 - 문서 체계 현대화 및 지식 영속화

- [x] `CONTEXT.md`를 단일 진실 공급원(Single Source of Truth)으로 신규 수립.
- [x] `AGENTS.md`의 시점 문구(과거 5월 여행 등)를 일반화하고 Mold Native 제약 규칙 추가.
- [x] 기존 기획서(`PROJECT.md`, `PROJECT_SAKE_REVISED.md`)를 `docs/archive/`로 이동하여 아카이빙.
- [x] `README.md`를 현재 사케 MVP 및 검증 명령어로 최신화.

Phase 13 완료 메모:

- 시스템 아키텍처, Mold Native 세션 브릿지, D1/R2 구성 및 데이터 모델을 `CONTEXT.md`에 일원화하여 영속화했다.
- AI 에이전트 작업 지침(`AGENTS.md`)의 판단 기준을 모바일 사케 테이스팅 경험 중심으로 갱신했다.
- 프로젝트 루트를 깔끔하게 정돈하고 개발/검증 진입점을 명확히 했다.

## MVP 이후로 미룰 것

- [ ] OCR.
- [ ] AI 추천 또는 라벨 인식.
- [ ] 통계 대시보드.
- [ ] 여러 술 타입별 전용 UI.
- [ ] 공통 flavor ontology.
- [ ] 동행과 안주를 별도 테이블로 분리.
- [ ] 가격, 용량, 도수, 일본주도 숫자 정규화.
- [ ] 이미지 순서 변경.
- [ ] 태그 삭제, 병합, 사용 횟수 기반 정렬.
- [ ] 공개 공유 기능.

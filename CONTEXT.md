# CONTEXT.md — 사케 테이스팅 로그 (Sake Tasting Log)

이 문서는 프로젝트의 시스템 아키텍처, 설계적 제약 조건, 데이터 모델, 핵심 비즈니스 규칙을 정의하는 **단일 진실 공급원(Single Source of Truth)**이다.

---

## 1. 프로젝트 개요 및 목표

* **제품명**: Sake Log (사케 테이스팅 로그)
* **목표**: 모바일 환경에서 사케(Sake)를 마실 때 **빠르고 간편하게 사진, 기본 정보, 맛의 방향, 재음용 의향, 장소 및 안주를 기록**하고 클라우드에 안전하게 동기화하는 Cloud-first 웹 애플리케이션이다.
* **핵심 철학**:
  * 술을 마신 상태에서도 1분 이내에 직관적으로 기록할 수 있도록 단순하고 군더더기 없는 UX를 유지한다.
  * `술 이름`만 필수이며, 나머지 모든 필드는 선택 사항이다.
  * 범용 주류(위스키, 와인 등) 기능으로 복잡도를 높이지 않고 사케 MVP 경험에 집중한다.

---

## 2. 시스템 아키텍처

```mermaid
graph TD
    Client[Mobile / Web Client (React + Vite)] -->|HTTPS / API Requests| Gateway[Cloudflare Pages Functions Gateway<br/>(functions/api/[[path]].ts)]
    
    subgraph Cloudflare Pages Functions
        Gateway -->|Google OAuth / Me / Images| AuthModule[Auth & Storage Module<br/>(functions/_shared/auth.ts)]
        Gateway -->|Request Wrapping & Session Bridge| MoldApp[Mold Native Hono App<br/>(functions/_shared/generated/mold_app.ts)]
    end

    AuthModule -->|User Profiles & Sessions| D1[(Cloudflare D1 Database)]
    AuthModule -->|Binary Image Streaming| R2[(Cloudflare R2 Bucket)]
    MoldApp -->|Resource CRUD (REST API)| D1
    MoldApp -->|Direct Image Blobs| R2
```

### 2.1 인프라 스택
* **Frontend**: React 18, TypeScript, Vite, Vanilla CSS (모바일 최적화)
* **Hosting / API**: Cloudflare Pages & Pages Functions (Hono 기반)
* **Database**: Cloudflare D1 (SQLite 분산 DB)
* **Storage**: Cloudflare R2 (이미지 원본 및 썸네일 WebP 저장)
* **Auth**: Google OAuth 2.0 (OpenID Connect 기반, 세션 쿠키 발급)

---

## 3. Mold Native 아키텍처 및 개발 제약 규칙

이 프로젝트는 백엔드 REST API와 데이터베이스 스키마 생성에 **Mold**를 사용한다.

### 3.1 단일 진실 공급원 (Single Source of Truth): `resources/*.yaml`
* 모든 테이블 스키마, 필드 제약, 인가 규칙(Permissions), 관계(Relations)는 `resources/` 디렉토리의 YAML 파일에 선언적으로 정의한다.
  * `resources/User.yaml`: 사용자 정보 및 권한
  * `resources/SakeRecord.yaml`: 사케 기록 메인 모델
  * `resources/SakeImage.yaml`: 사케 사진 메타데이터
  * `resources/Tag.yaml`: 맛/향/느낌 태그 (기본 및 커스텀)
  * `resources/RecordTag.yaml`: 기록과 태그의 N:M 매핑

### 3.2 생성 코드 불변성 원칙 (Generated Code Immutability)
* `functions/_shared/generated/mold_app.ts`는 Mold CLI에 의해 자동 생성되는 **컴파일 산출물**이다.
* **규칙**: `functions/_shared/generated/` 내부 코드를 직접 수동 패치하여 비즈니스 로직을 구현하지 않는다. Mold로 코드를 언제든 다시 생성(Overwrite)하더라도 시스템이 안전하게 동작해야 한다.

### 3.3 세션 브릿지 어댑터 (Session Bridge Pattern)
* Google OAuth를 통해 발급된 `alcohol_log_session` 세션을 Mold의 표준 세션 체계(`mold_session` / `_mold_sessions`)로 매끄럽게 연결하기 위해 **외부 래핑 브릿지**를 운영한다.
* `functions/_shared/auth.ts`: 로그인/로그아웃 시 `oauth_sessions`와 `_mold_sessions`를 동시에 동기화/삭제한다.
* `functions/api/[[path]].ts`: `onRequest`에서 `moldApp.fetch()`를 호출하기 직전, `prepareMoldRequest()`가 유효 세션 쿠키를 검사하여 Mold가 요구하는 `Cookie: mold_session=...` 헤더를 투명하게 주입한다.

---

## 4. 도메인 및 UI/UX 규칙

### 4.1 핵심 입력 플로우 ("오늘의 한 잔 기록")
기록 작성/수정 화면은 반드시 다음 순서를 따른다:
1. **사진들**: 대표 이미지 + 추가 이미지 (다중 업로드, 썸네일 자동 생성)
2. **기본 정보**: 술 이름(필수), 지역, 양조장, 쌀, 종류, 일본주도, 도수, 용량, 가격
3. **다시 마실까?**: `별로 (no)`, `잘모르겠음 (unsure)`, `다시 마신다 (yes)` (3-Way 선택)
4. **평가 (버튼형 척도)**:
   * 달콤함 - 드라이함: `아주 달콤함(1)` ~ `아주 드라이함(5)` (5단계)
   * 은은함 - 화려함: `은은한향(1)`, `보통(2)`, `화려한향(3)` (3단계)
   * 산미: `산미없음(1)`, `산미보통(2)`, `산미높음(3)` (3단계)
   * 깔끔함 - 감칠맛: `깔끔함(1)`, `보통(2)`, `감칠맛좋은(3)` (3단계)
5. **한줄 메모**: 자유 텍스트 (오늘 마신 느낌)
6. **특성 태그**: 맛(`taste`), 향(`aroma`), 느낌(`mood`) 칩 그룹 (기본 태그 + `+` 버튼으로 커스텀 태그 추가 즉시 반영)
7. **외부 정보**: 장소, 날짜(기본값 오늘), 동행, 안주

### 4.2 상세 화면 순서
1. 사진 갤러리 ➔ 2. 술 이름 ➔ 3. 다시 마실까? ➔ 4. 평가 요약 ➔ 5. 한줄 메모 ➔ 6. 특성 태그 ➔ 7. 기본 정보 전체 ➔ 8. 외부 정보 ➔ 9. 수정/삭제 버튼

---

## 5. 저장소 및 데이터 freshness 기준

* **Cloud-first**: 모든 실제 데이터는 Cloudflare D1 및 R2에 저장되며, 비로그인 상태에서는 Google 로그인 안내 화면을 표시하여 로컬 데이터와의 오염을 원천 차단한다.
* **캐시 무효화**: 모든 데이터 변경 및 API 응답에는 `Cache-Control: no-store`를 명시하여 데이터 신선도를 보장한다.
* **IndexedDB**: 클라우드 저장소가 주 저장소이며, 로컬 IndexedDB는 오프라인 대비용 보조 레이어로만 격리 유지한다.

---

## 6. 검증 및 빌드 파이프라인

모든 변경 사항은 커밋 전 아래 3가지 검증을 100% 무결하게 통과해야 한다:

```powershell
# 1. 프론트엔드 TypeScript 검증
npm.cmd run typecheck

# 2. Cloudflare Pages Functions 백엔드 TypeScript 검증
npm.cmd run typecheck:functions

# 3. 배포 번들 빌드 검증
npm.cmd run build
```

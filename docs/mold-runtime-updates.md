# Mold 런타임 업데이트 및 drink-log 연동 가이드 (2026-08-19)

> 이 문서는 2026-08-19 Mold 코어 Phase 11에서 진행된 **관계형 기능 확장(Nested Read/Write)** 및 **Cloudflare Codegen 수정 사항**을 정리하고, drink-log 서비스에서의 활용 가이드와 변경 내역을 공유하기 위한 문서입니다.

---

## 1. 개요 및 배경

기존 drink-log 프로덕션 운영 중 발생했던 주요 마찰(Friction)은 다음과 같았습니다:
- **N+1 조회 마찰 (Nested Read)**: 사케 기록 목록 화면에서 기록 본문, 이미지 목록, 태그 목록을 조립하기 위해 요청당 6~10회의 개별 HTTP API 호출이 발생함.
- **다단계 생성 마찰 (Nested Write)**: 사케 기록 작성 시 본문 생성 ➔ 발급된 ID 확인 ➔ 이미지 등록 ➔ 태그 관계(ecord_tags) 등록을 클라이언트가 여러 단계에 걸쳐 순차 호출해야 함.

Mold 코어 Phase 11을 통해 이 두 가지 마찰이 완전히 해결되었으며, drink-log/functions/_shared/generated/mold_app.ts가 최신 코드로 재생성되었습니다.

---

## 2. 주요 변경 및 신규 기능

### (1) 관계 조인 Eager Loading (Nested Read, ?include=)

단일 HTTP 요청으로 1-depth has_many 및 elongs_to 연관 리소스들을 함께 조회하여 응답 객체에 내포(embed)합니다.

* **지원 엔드포인트 예시**:
  - GET /api/sake_records?include=images (사케 기록 목록 + 연관 이미지 목록 배열)
  - GET /api/sake_records?include=images,record_tags (이미지와 태그 연결 레코드 동시 내포)
  - GET /api/sake_records/12?include=images,record_tags (단일 상세 조회 시 내포)
  - GET /api/tags?include=record_tags
* **동작 방식**:
  1. 메인 레코드 목록 조회 후 부모 ID들을 수집.
  2. Cloudflare D1 단일 배치 쿼리(WHERE record_id IN (?, ?, ...))로 자식 레코드들을 일괄 조회 (N+1 쿼리 방지).
  3. 각 자식 레코드별 권한(ActionRead) 및 민감 필드 Sanitization 적용.
  4. 매칭되는 자식이 0건인 경우 
ull이 아닌 [] (빈 배열) 기본 할당.
* **안전장치 (Safety Constraints)**:
  - **부모당 최대 50건 상한**: 자식 레코드가 50건을 초과하면 조용히 자르지 않고 즉시 400 Bad Request (code: INCLUDE_TOO_LARGE)로 거절하여 데이터 누락 방지.
  - **2-depth 점 체이닝 거부**: ?include=record_tags.tag 같은 중첩 체이닝 시도 시 400 Bad Request (code: INVALID_INCLUDE)로 명시적 거절.

---

### (2) 관계형 중첩 쓰기 (Nested Writes, Option B)

부모 리소스 생성 요청(POST /api/{parent}) 단 1회로 has_many 자식 레코드들을 동시에 생성합니다.

* **요청 페이로드 예시**:
  `json
  POST /api/sake_records
  Content-Type: application/json

  {
    "name": "獺祭 23",
    "brewery": "旭酒造",
    "consumed_date": "2026-08-19T12:00:00Z",
    "drink_again": "yes",
    "sweet_dry": 3,
    "images": [
      {
        "file_name": "bottle.jpg",
        "mime_type": "image/jpeg",
        "display_order": 0
      }
    ],
    "record_tags": [
      { "tag_id": 1 },
      { "tag_id": 4 }
    ]
  }
  `
* **동작 및 안전 파이프라인**:
  1. **사전 검증 (Pre-validation First)**: 부모 레코드가 D1에 삽입되기 **전에**, 모든 자식 항목들에 대해 권한(ActionCreate), client_writable: false 위반 여부, 타입 및 제약조건(min_length, enum values, min/max 등), 최대 개수(50개)를 먼저 검증합니다. 검증 실패 시 부모 레코드는 D1에 0건 생성됩니다.
  2. **순차 생성 및 외래키(FK) 자동 주입**: 부모 생성 성공 후 발급된 id를 자식 레코드의 ecord_id/sake_record_id 컬럼과 owner_id에 서버가 자동으로 주입하여 순차 생성합니다.
  3. **물리적 보상 롤백 (Compensating Rollback)**: 자식 레코드 생성 도중 에러(UNIQUE 충돌 등)가 발생하면, 요청 스코프에서 이미 생성된 자식 레코드들과 부모 레코드를 **생성의 역순으로 물리적 하드 딜리트(DELETE FROM table WHERE id = ?)**하여 DB를 0건 상태로 복구합니다.
  4. **Multipart Form 결합 지원**: multipart/form-data 요청에서도 폼 필드로 전달된 JSON 배열 문자열을 파싱하여 부모 Blob 업로드와 중첩 자식 생성을 1-Step으로 완결할 수 있습니다.
* **응답**: 201 Created와 함께 생성된 부모 레코드 및 자식 레코드 배열이 전체 내포된 JSON으로 반환됩니다.

---

### (3) Cloudflare Codegen 및 런타임 버그 수정

1. **HTML View 제출 핸들러 insertSql 선언 누락 수정**:
   - POST /view/{table} 뷰 폼 제출 핸들러 내부에서 const insertSql 변수 선언이 누락되어 런타임 ReferenceError가 발생할 수 있던 생성기 결함을 수정했습니다.
2. **Resource 생성 순서의 결정성(Determinism) 확보**:
   - Go Registry.List()의 맵 순회 비결정성으로 인해 mold_app.ts 생성 시마다 테이블 라우트 순서가 바뀌던 문제를 리소스 이름 기준 알파벳 정렬(sort.Slice)로 고정하여, 언제 생성해도 항상 동일한 diff와 코드가 산출되도록 보장했습니다.
3. **TypeScript 타입 검사 호환성 보정**:
   - D1 .first() 호출부의 반환값 타입 어설션을 보정하여 
pm run typecheck:functions (TypeScript 5.x) 컴파일 검사를 100% 통과하도록 정비했습니다.

---

## 3. 검증 결과 요약

- **drink-log 함수 타입 검사**: 
pm run typecheck:functions ➔ **0 errors (PASS)**
- **drink-log 프론트엔드 타입 검사**: 
pm run typecheck ➔ **0 errors (PASS)**
- **drink-log Vite 프로덕션 빌드**: 
pm run build ➔ **dist 출력 완료 (PASS)**
- **Mold 코어 회귀 테스트**: go test -count=1 ./... ➔ **18개 패키지 100% PASS**

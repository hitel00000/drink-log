# 🍶 Sake Tasting Log App — Product Specification

## 1. Overview

이 앱은 사케를 마실 때마다 사진, 기본 정보, 맛의 인상, 다시 마실 의향, 장소와 동행 정보를 빠르게 기록하는 개인용 시음 기록 앱이다.

초기 버전은 **사케 기록에 집중**한다.  
위스키, 진, 럼, 한국 전통주, 와인 등은 당장 구현하지 않고, 나중에 확장할 수 있도록 데이터 구조만 지나치게 막지 않는 선에서 설계한다.

핵심 목표:

- 사케 기록을 빠르게 남긴다.
- 사진 여러 장을 함께 저장한다.
- 술 이름은 필수로 받고, 나머지는 선택 입력으로 둔다.
- 취한 상태에서도 입력 가능한 단순 UI를 유지한다.
- 개인이 직접 추가한 태그는 다음 기록에도 다시 사용할 수 있게 한다.
- 사케 중심 UI를 만들되, 장기적으로 다른 술 타입도 추가 가능한 구조를 유지한다.

---

## 2. Product Direction

### 2.1 이번 버전의 판단

기존 방향은 여러 술을 한 번에 다루는 범용 주류 감각 데이터 시스템에 가까웠다.  
하지만 현재 우선순위는 명확하다.

> **먼저 사케 기록 앱을 제대로 만든다.**

따라서 초기 제품은 다음을 하지 않는다.

- 모든 주류 공통 flavor ontology를 먼저 만들지 않는다.
- Nose / Palate / Finish 같은 전문가형 시음 구조를 강요하지 않는다.
- 입력 항목을 과하게 세분화하지 않는다.
- 통계, 추천, AI 분석은 후순위로 둔다.

초기 제품은 다음에 집중한다.

- 오늘 마신 사케를 잊지 않게 기록한다.
- 사진과 기본 정보를 남긴다.
- 맛의 방향성을 빠르게 선택한다.
- 마음에 들었는지, 다시 마실지 판단을 남긴다.
- 다음에 검색하고 비교할 수 있게 한다.

---

## 3. Core Record: 오늘의 한 잔 기록

하나의 기록은 “오늘 마신 사케 한 병 또는 한 잔”을 의미한다.

### 3.1 입력 순서

1. 사진들
2. 기본 정보
3. 다시 마실까?
4. 평가
5. 한줄 메모
6. 특성 태그
7. 외부 정보

이 순서는 UI에서도 그대로 따른다.

---

## 4. Sake Record Fields

### 4.1 Photos

사진은 여러 장 넣을 수 있다.

용도:

- 병 사진
- 라벨 사진
- 뒷라벨 사진
- 잔에 따른 모습
- 음식과 함께 찍은 사진
- 메뉴판 또는 매장 정보 사진

초기 구현:

- 기록 하나에 여러 이미지 연결
- 첫 번째 이미지를 대표 이미지로 사용
- 이미지 순서 변경은 후순위
- OCR은 후순위

---

### 4.2 Basic Information

기본 정보는 사케 자체에 대한 정보다.

| 필드 | 필수 여부 | 예시 | 메모 |
|---|---:|---|---|
| 술 이름 | 필수 | 獺祭 純米大吟醸 45 | 가장 중요한 검색 기준 |
| 지역 | 선택 | 효고, 니가타, 야마구치 | 일본 지역명 |
| 양조장 | 선택 | 旭酒造, ○○酒造 | brewery / kura |
| 쌀 | 선택 | 야마다니시키 | 원료미 |
| 종류 | 선택 | 준마이다이긴죠, 순미음양주 | 사용자가 한글/일본어 혼용 가능 |
| 일본주도 | 선택 | +1 | 숫자 또는 텍스트 |
| 도수 | 선택 | 15% | ABV |
| 용량 | 선택 | 720ml | ml 단위 권장 |
| 가격 | 선택 | 3000 yen | 통화 자유 입력 |

초기 UI 원칙:

- 술 이름만 필수 표시를 강하게 둔다.
- 나머지는 접이식 또는 가벼운 입력칸으로 둔다.
- 모르면 비워도 된다는 느낌을 준다.
- 일본 여행 중 빠르게 기록할 수 있어야 한다.

---

### 4.3 다시 마실까?

하나만 선택한다.

선택지:

1. 별로
2. 잘모르겠음
3. 다시 마신다

의미:

- 별점보다 실용적인 판단이다.
- 나중에 재구매/재방문 기준으로 쓰기 좋다.
- 초보자에게도 부담이 적다.

UI 권장:

```text
다시 마실까?

[별로] [잘모르겠음] [다시 마신다]
```

저장값 예시:

```json
"drink_again": "yes | unsure | no"
```

---

### 4.4 평가

평가는 모든 카테고리에서 하나씩 선택한다.

#### 4.4.1 달콤함 - 드라이함

선택지:

- 아주 달콤함
- 달콤함
- 보통
- 드라이함
- 아주 드라이함

저장값 예시:

```json
"sweet_dry": 1
```

권장 매핑:

| 값 | 표시 |
|---:|---|
| 1 | 아주 달콤함 |
| 2 | 달콤함 |
| 3 | 보통 |
| 4 | 드라이함 |
| 5 | 아주 드라이함 |

---

#### 4.4.2 은은함 - 화려함

선택지:

- 은은한향
- 보통
- 화려한향

저장값 예시:

```json
"aroma_intensity": 1
```

권장 매핑:

| 값 | 표시 |
|---:|---|
| 1 | 은은한향 |
| 2 | 보통 |
| 3 | 화려한향 |

---

#### 4.4.3 산미

선택지:

- 산미없음
- 산미보통
- 산미높음

저장값 예시:

```json
"acidity": 2
```

권장 매핑:

| 값 | 표시 |
|---:|---|
| 1 | 산미없음 |
| 2 | 산미보통 |
| 3 | 산미높음 |

---

#### 4.4.4 깔끔함 - 감칠맛

선택지:

- 깔끔함
- 보통
- 감칠맛좋은

저장값 예시:

```json
"clean_umami": 3
```

권장 매핑:

| 값 | 표시 |
|---:|---|
| 1 | 깔끔함 |
| 2 | 보통 |
| 3 | 감칠맛좋은 |

---

### 4.5 한줄 메모

자유 입력 텍스트.

예시:

- “과일향이 예쁘고 차갑게 마시니 좋았다.”
- “안주 없이 마시기엔 조금 강했다.”
- “처음엔 평범했는데 회랑 먹으니 맛있었다.”

UI 원칙:

- 길게 쓰게 만들지 않는다.
- placeholder는 감각보다 기억을 돕는 방향이 좋다.

권장 placeholder:

```text
오늘 마신 느낌을 한 줄로 남겨보세요.
```

---

## 5. Tags

태그는 세 그룹으로 나눈다.

- 맛 태그
- 향 태그
- 느낌 태그

각 그룹에는 기본 태그가 있고, 사용자는 `+` 버튼으로 새 태그를 직접 추가할 수 있다.  
사용자가 추가한 태그는 다음 기록에서도 같은 그룹 안에 다시 보여준다.

---

### 5.1 맛 태그

기본 태그:

- 산뜻
- 감칠
- 부드러움
- 진함
- 깔끔함
- 쌉쌀함
- 달콤함

주의:

- “부드러음”은 오타이므로 “부드러움”으로 고친다.
- “감칠”과 “감칠맛좋은”은 역할이 다르다.
  - 평가는 축이다.
  - 태그는 느낌을 보조하는 키워드다.

---

### 5.2 향 태그

기본 태그:

- 누룩
- 쌀
- 과일
- 꽃
- 사과
- 파인애플
- 멜론
- 배
- 허브
- 요구르트
- 견과

---

### 5.3 느낌 태그

기본 태그:

- 독특
- 무난
- 안주랑 먹기 좋음
- 식전주

---

### 5.4 Custom Tag Behavior

사용자가 `+`를 눌러 태그를 추가할 수 있다.

규칙:

- 추가한 태그는 해당 그룹에 저장한다.
- 다음 기록에서도 해당 그룹의 태그 목록에 보여준다.
- 같은 이름의 태그는 중복 생성하지 않는다.
- 앞뒤 공백은 제거한다.
- 빈 문자열은 저장하지 않는다.
- 너무 긴 태그는 제한한다. 권장 최대 20자.
- 삭제 기능은 후순위로 둔다.
- 사용 횟수가 많은 태그를 먼저 보여주는 기능은 후순위로 둔다.

저장 예시:

```json
{
  "tag_group": "aroma",
  "label": "백도",
  "is_default": false
}
```

---

## 6. External Context

외부 정보는 사케 자체가 아니라 “마신 상황”에 대한 정보다.

| 필드 | 필수 여부 | 예시 | 메모 |
|---|---:|---|---|
| 장소 | 선택 | 후쿠오카 ○○ 이자카야 | 매장명 또는 집 |
| 날짜 | 기본값 있음 | 오늘 날짜 | 기본값은 오늘 |
| 동행 | 선택 | 남자친구, 친구 A | 자유 입력 |
| 안주 | 선택 | 사시미, 야키토리 | 여러 개 입력 가능하게 확장 가능 |

날짜 기본값:

- 새 기록 생성 시 오늘 날짜를 자동 입력한다.
- 사용자가 수정할 수 있다.

---

## 7. Data Model

초기에는 사케 중심 모델을 사용한다.  
다만 `drink_type` 필드를 두어 나중에 다른 술로 확장할 여지를 남긴다.

### 7.1 sake_records

```sql
CREATE TABLE sake_records (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,

  drink_type TEXT NOT NULL DEFAULT 'sake',

  name TEXT NOT NULL,
  region TEXT,
  brewery TEXT,
  rice TEXT,
  sake_type TEXT,
  sake_meter_value TEXT,
  abv TEXT,
  volume TEXT,
  price TEXT,

  drink_again TEXT CHECK (drink_again IN ('no', 'unsure', 'yes')),

  sweet_dry INTEGER CHECK (sweet_dry BETWEEN 1 AND 5),
  aroma_intensity INTEGER CHECK (aroma_intensity BETWEEN 1 AND 3),
  acidity INTEGER CHECK (acidity BETWEEN 1 AND 3),
  clean_umami INTEGER CHECK (clean_umami BETWEEN 1 AND 3),

  one_line_note TEXT,

  place TEXT,
  consumed_date TEXT NOT NULL,
  companions TEXT,
  food_pairing TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

설계 판단:

- `name`만 필수다.
- 일본주도, 도수, 가격, 용량은 사용자가 다양한 형식으로 입력할 수 있으므로 초기에는 `TEXT`로 둔다.
- 나중에 통계가 필요해지면 `abv_number`, `price_amount`, `currency`, `volume_ml` 같은 정규화 필드를 추가한다.
- `companions`, `food_pairing`은 초기에는 자유 텍스트로 둔다.
- 동행/안주를 별도 테이블로 빼는 것은 후순위다.

---

### 7.2 sake_images

```sql
CREATE TABLE sake_images (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  image_key TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,

  FOREIGN KEY (record_id) REFERENCES sake_records(id) ON DELETE CASCADE
);
```

R2 저장 경로 예시:

```text
images/{owner_id}/sake/{record_id}/{image_id}.jpg
```

---

### 7.3 tags

```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  drink_type TEXT NOT NULL DEFAULT 'sake',
  tag_group TEXT NOT NULL CHECK (tag_group IN ('taste', 'aroma', 'mood')),
  label TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,

  UNIQUE(owner_id, drink_type, tag_group, label)
);
```

설계 판단:

- 기본 태그는 `owner_id`를 `NULL`로 둘 수 있다.
- 사용자 추가 태그는 `owner_id`를 가진다.
- 사케 전용 태그로 시작하지만 `drink_type`을 남겨 확장성을 둔다.

---

### 7.4 record_tags

```sql
CREATE TABLE record_tags (
  record_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL,

  PRIMARY KEY (record_id, tag_id),
  FOREIGN KEY (record_id) REFERENCES sake_records(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

---

## 8. Initial Default Tags

초기 데이터로 넣는다.

```sql
INSERT INTO tags (id, owner_id, drink_type, tag_group, label, is_default, created_at) VALUES
  ('tag_taste_fresh', NULL, 'sake', 'taste', '산뜻', 1, CURRENT_TIMESTAMP),
  ('tag_taste_umami', NULL, 'sake', 'taste', '감칠', 1, CURRENT_TIMESTAMP),
  ('tag_taste_soft', NULL, 'sake', 'taste', '부드러움', 1, CURRENT_TIMESTAMP),
  ('tag_taste_rich', NULL, 'sake', 'taste', '진함', 1, CURRENT_TIMESTAMP),
  ('tag_taste_clean', NULL, 'sake', 'taste', '깔끔함', 1, CURRENT_TIMESTAMP),
  ('tag_taste_bitter', NULL, 'sake', 'taste', '쌉쌀함', 1, CURRENT_TIMESTAMP),
  ('tag_taste_sweet', NULL, 'sake', 'taste', '달콤함', 1, CURRENT_TIMESTAMP),

  ('tag_aroma_koji', NULL, 'sake', 'aroma', '누룩', 1, CURRENT_TIMESTAMP),
  ('tag_aroma_rice', NULL, 'sake', 'aroma', '쌀', 1, CURRENT_TIMESTAMP),
  ('tag_aroma_fruit', NULL, 'sake', 'aroma', '과일', 1, CURRENT_TIMESTAMP),
  ('tag_aroma_flower', NULL, 'sake', 'aroma', '꽃', 1, CURRENT_TIMESTAMP),
  ('tag_aroma_apple', NULL, 'sake', 'aroma', '사과', 1, CURRENT_TIMESTAMP),
  ('tag_aroma_pineapple', NULL, 'sake', 'aroma', '파인애플', 1, CURRENT_TIMESTAMP),
  ('tag_aroma_melon', NULL, 'sake', 'aroma', '멜론', 1, CURRENT_TIMESTAMP),
  ('tag_aroma_pear', NULL, 'sake', 'aroma', '배', 1, CURRENT_TIMESTAMP),
  ('tag_aroma_herb', NULL, 'sake', 'aroma', '허브', 1, CURRENT_TIMESTAMP),
  ('tag_aroma_yogurt', NULL, 'sake', 'aroma', '요구르트', 1, CURRENT_TIMESTAMP),
  ('tag_aroma_nut', NULL, 'sake', 'aroma', '견과', 1, CURRENT_TIMESTAMP),

  ('tag_mood_unique', NULL, 'sake', 'mood', '독특', 1, CURRENT_TIMESTAMP),
  ('tag_mood_easy', NULL, 'sake', 'mood', '무난', 1, CURRENT_TIMESTAMP),
  ('tag_mood_food', NULL, 'sake', 'mood', '안주랑 먹기 좋음', 1, CURRENT_TIMESTAMP),
  ('tag_mood_aperitif', NULL, 'sake', 'mood', '식전주', 1, CURRENT_TIMESTAMP);
```

---

## 9. UI Structure

### 9.1 Add Sake Record Screen

권장 순서:

```text
[사진 추가 영역]

기본 정보
- 술 이름 *
- 지역
- 양조장
- 쌀
- 종류
- 일본주도
- 도수
- 용량
- 가격

다시 마실까?
[별로] [잘모르겠음] [다시 마신다]

평가
달콤함 ───── 드라이함
[아주 달콤함] [달콤함] [보통] [드라이함] [아주 드라이함]

은은함 ───── 화려함
[은은한향] [보통] [화려한향]

산미
[산미없음] [산미보통] [산미높음]

깔끔함 ───── 감칠맛
[깔끔함] [보통] [감칠맛좋은]

한줄 메모
[오늘 마신 느낌을 한 줄로 남겨보세요.]

특성
맛 태그
[산뜻] [감칠] [부드러움] ... [+]

향 태그
[누룩] [쌀] [과일] ... [+]

느낌
[독특] [무난] [안주랑 먹기 좋음] ... [+]

외부 정보
- 장소
- 날짜
- 동행
- 안주

[저장]
```

---

### 9.2 UI Component Rules

#### Photos

- 화면 최상단에 둔다.
- 큰 대표 이미지 영역 + 작은 썸네일 구조가 좋다.
- 사진이 없을 때는 “사진 추가” 버튼을 크게 보여준다.

#### Basic Info

- 술 이름은 바로 보이게 한다.
- 나머지 항목은 한 화면에 너무 빽빽하지 않게 배치한다.
- 여행 중 입력을 고려하면 모든 항목을 강제하면 안 된다.

#### 다시 마실까?

- 별점보다 위에 둔다.
- 이 앱의 핵심 판단값으로 취급한다.
- 선택하지 않아도 저장 가능하게 할지, 필수로 할지는 MVP에서 결정한다.
- 추천: 선택 권장, 필수 아님.

#### 평가

- 버튼형 선택이 좋다.
- 슬라이더보다 명확한 텍스트 버튼이 낫다.
- 사케 초보자도 고를 수 있어야 한다.

#### Tags

- 여러 개 선택 가능.
- 선택된 태그는 칩 색상으로 강조한다.
- `+` 버튼은 각 그룹 끝에 둔다.
- 새 태그 추가 후 자동 선택되게 한다.

#### One-line Memo

- 태그보다 앞에 둔다.
- 기억의 핵심을 먼저 적고, 태그는 보조로 붙이는 흐름이 자연스럽다.

---

## 10. List Screen

초기 리스트에서 보여줄 정보:

- 대표 사진
- 술 이름
- 종류 또는 지역
- 다시 마실까?
- 날짜
- 주요 태그 2~3개

정렬 기본값:

- 최신순

후순위 필터:

- 다시 마실 사케만 보기
- 지역별 보기
- 종류별 보기
- 태그별 보기
- 양조장 검색
- 쌀 품종 검색

---

## 11. Detail Screen

상세 화면에서 보여줄 정보:

1. 사진 갤러리
2. 술 이름
3. 다시 마실까?
4. 평가 요약
5. 한줄 메모
6. 특성 태그
7. 기본 정보 전체
8. 외부 정보
9. 수정 버튼

평가 요약 예시:

```text
달콤함 · 화려한향 · 산미보통 · 깔끔함
```

---

## 12. Search and Filter

MVP 검색 대상:

- 술 이름
- 지역
- 양조장
- 종류
- 쌀
- 태그
- 장소
- 메모

초기 검색은 단순 문자열 검색으로 충분하다.

---

## 13. Authentication and Authorization

서버 없이 완전 로컬 앱으로 시작할 수도 있지만, Cloudflare D1/R2를 사용하는 경우 인증은 필요하다.

기본 방향:

- Google OAuth 사용
- 사용자별 데이터 분리
- 모든 record, image, custom tag에 `owner_id` 적용
- 다른 사용자의 기록은 읽기/수정/삭제 불가
- 이미지 업로드 API도 인증 필요

기본 users 테이블:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  UNIQUE (provider, provider_user_id)
);
```

---

## 14. Technical Architecture

초기 권장 구조:

```text
[PWA Frontend]
      ↓
[Cloudflare Workers / Pages Functions API]
      ↓
[D1: records, tags]
[R2: images]
```

권장 스택:

- Frontend: React 또는 React Native Web 대응 구조
- App/PWA: Expo 또는 Vite PWA 중 선택
- Backend: Cloudflare Workers / Pages Functions
- Database: Cloudflare D1
- Image Storage: Cloudflare R2
- Auth: Google OAuth

---

## 15. API Draft

### 15.1 Records

```http
GET /api/sake-records
POST /api/sake-records
GET /api/sake-records/:id
PUT /api/sake-records/:id
DELETE /api/sake-records/:id
```

### 15.2 Images

```http
POST /api/sake-records/:id/images
DELETE /api/sake-records/:id/images/:imageId
```

### 15.3 Tags

```http
GET /api/tags?drink_type=sake
POST /api/tags
```

### 15.4 Search

```http
GET /api/sake-records/search?q=...
```

---

## 16. MVP Scope

반드시 구현:

- 사케 기록 생성
- 사진 여러 장 추가
- 술 이름 필수 입력
- 기본 정보 입력
- 다시 마실까 선택
- 4개 평가 카테고리 선택
- 한줄 메모
- 기본 태그 선택
- 커스텀 태그 추가
- 날짜 기본값 오늘
- 기록 리스트
- 기록 상세
- 기록 수정
- 기록 삭제

MVP에서 미뤄도 되는 것:

- OCR
- AI 추천
- 술 라벨 자동 인식
- 통계 대시보드
- 여러 술 타입별 전용 UI
- 복잡한 flavor ontology
- 동행/안주 별도 DB화
- 가격/용량/도수 숫자 정규화
- 이미지 순서 변경
- 태그 삭제/병합
- 공개 공유 기능

---

## 17. Future Expansion

다른 술로 확장할 때 추가할 수 있는 방향:

```text
drink_type:
- sake
- whisky
- wine
- gin
- rum
- korean_traditional
- beer
```

확장 방식:

- 공통 필드: 이름, 사진, 도수, 가격, 장소, 날짜, 메모, 태그
- 술 타입별 필드: 사케의 일본주도/쌀/종류처럼 별도 테이블 또는 JSON 필드로 관리
- 술 타입별 평가 축: 사케와 위스키는 다르게 구성
- UI는 profile별로 다르게 보여준다.

중요한 원칙:

> 지금은 범용 앱을 만들지 않는다.  
> 지금은 사케 앱을 만든다.  
> 다만 나중에 망하지 않도록 `drink_type`만 열어둔다.

---

## 18. Final Product Principle

이 앱은 전문가용 시음 노트가 아니라, 사용자가 실제로 술을 마신 기억을 잃지 않게 도와주는 앱이다.

가장 중요한 기록은 이것이다.

1. 무슨 술이었나?
2. 어디서 누구와 마셨나?
3. 맛이 어떤 방향이었나?
4. 다시 마시고 싶은가?
5. 다음에 떠올릴 수 있는 사진과 한줄 기억이 있는가?

사케 기록 앱으로 시작한다.  
작고 정확하게 시작한 뒤, 실제 기록이 쌓이면 그때 확장한다.

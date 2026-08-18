# 🥃 Alcohol Tasting Log App (Serverless PWA) — Product Specification

## 1. Overview

이 앱은 다양한 주류(위스키, 사케, 진, 럼, 한국 전통주 등)를 마신 경험을  
**“최소 입력 + 구조화된 감각 데이터”**로 기록하는 개인용 PWA이다.

핵심 목표:

- 서버 없이 동작 (Serverless)
- 입력 최소화 (취한 상태에서도 사용 가능)
- 이미지 기반 기록 (라벨/병 중심)
- 감각 데이터 구조화 (flavor ontology)
- 주류 종류 확장 가능 구조

---

## 2. Core Concept

> “술을 기록하는 앱이 아니라,  
> 술의 감각 구조를 축적하는 개인 데이터 시스템”

---

## 3. System Architecture

```

[PWA Frontend]
↓
[Cloudflare Workers API]
↓
┌─────────────────────┐
│ Cloudflare R2       │ (Images)
│ Cloudflare D1       │ (Structured Data)
└─────────────────────┘

````

### Stack

- Frontend: PWA (React/Vue/Svelte)
- Backend: Cloudflare Workers
- Storage: Cloudflare R2
- Database: Cloudflare D1
- Auth: Google OAuth

### Authentication and Authorization

Cloudflare integration must not expose unauthenticated write APIs. The frontend may be
static, but any Pages Functions / Workers endpoint that writes to D1 or R2 must require
an authenticated user before allowing create, update, or delete operations.

Initial auth direction:

- Use Google OAuth as the application login.
- Store the Google identity in a `users` table.
- Treat `provider + provider_user_id` as the stable external identity key.
- Use the Google `sub` claim as `provider_user_id`; do not rely on email as the primary
  identity because email can change.
- Issue an application session cookie from the Cloudflare Worker / Pages Function after
  the OAuth callback is verified.

Minimum `users` shape:

```sql
users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  UNIQUE (provider, provider_user_id)
)
```

Authorization model:

- Add `owner_id` foreign keys to user-owned records such as `bottles`, `images`, and
  `sensory_notes`.
- Every read/write API must derive the current user from the session and filter by
  `owner_id`.
- Return `403` for detail, update, or delete attempts against records owned by another
  user.
- R2 image keys should be resolved through authorized API logic instead of exposing a
  write path directly from the browser.

Cloudflare Access with email OTP can still be useful as a temporary outer gate for a
private test deployment, but it only authenticates allowed visitors. It does not replace
row-level authorization when multiple people use the app.

---

## 4. Core Data Model

### 4.1 Bottle (Drink Entity)

하나의 술 = 하나의 기록 단위

```json
{
  "id": "bottle_id",
  "name": "Yamazaki 12",
  "type": "whisky",
  "brand": "Suntory",
  "abv": 43,
  "created_at": "timestamp"
}
````

---

### 4.2 Images (N per Bottle)

```
bottle (1) → images (N)
```

```json
{
  "id": "image_id",
  "bottle_id": "bottle_id",
  "image_key": "r2_path",
  "created_at": "timestamp"
}
```

---

### 4.3 Sensory Notes

```json
{
  "bottle_id": "id",
  "profile": "whisky",
  "nose": [],
  "palate": [],
  "finish": []
}
```

---

### 4.4 Flavor Entry

```json
{
  "flavor": "smoky",
  "intensity": 3,
  "valence": "positive | negative | neutral",
  "category": "smoke"
}
```

---

## 5. Flavor Vocabulary System

### 5.1 Core Design Principles

* 모든 주류 공통 vocabulary 사용
* 술 종류별 태그 분리 금지
* UI가 아닌 구조에서 통합

---

### 5.2 Flavor Vocabulary (50~60개)

#### 🍬 Sweet / Fruit

* sweet
* honey
* caramel
* vanilla
* fruity
* citrus
* tropical
* dried_fruit
* jammy

---

#### 🌸 Floral / Herbal

* floral
* rose
* lavender
* herbal
* tea_like
* green
* grass
* mint

---

#### 🔥 Spice / Heat

* spicy
* peppery
* cinnamon
* ginger
* warm
* alcohol_heat
* harsh_burn

---

#### 🌳 Wood / Earth

* woody
* oak
* earthy
* tobacco
* leather
* nutty
* umami

---

#### 💨 Smoke / Off-note

* smoky
* peaty
* charred
* funky
* fermented
* solvent_like
* metallic

---

#### 💧 Texture / Mouthfeel

* light_body
* medium_body
* full_body
* oily
* smooth
* rough
* thin
* creamy

---

## 6. Profile System (주류 종류 대응)

### 핵심 원칙

> 데이터 구조는 동일, UI만 변경

---

### Profiles

* whisky
* sake
* gin
* rum
* korean_traditional
* wine (future)

---

### Profile Effect

| Profile            | UI 구조                           |
| ------------------ | ------------------------------- |
| Whisky             | Nose / Palate / Finish          |
| Sake               | Aroma / Taste / Aftertaste      |
| Gin                | Botanical / Citrus / Finish     |
| Korean Traditional | Sweetness / Body / Alcohol feel |

---

## 7. Negative Flavor Handling

### 핵심 개념

불쾌한 맛은 단순 태그가 아니라 구조적 신호로 기록

---

### Negative Flavors

* alcohol_heat
* harsh_burn
* solvent_like
* metallic
* bitter_edge

---

### Valence System

* positive
* neutral
* negative

---

## 8. UX Design Principles

### 8.1 Core UX Rule

> “항상 6개 이하만 보여준다”

---

### 8.2 Input Flow

#### Step 1: Bottle 선택

* 검색 or 생성

---

#### Step 2: 사진 촬영

* 라벨 / 병

---

#### Step 3: Flavor 입력

```
[카테고리 6개]
Sweet | Floral | Spice
Wood  | Smoke  | Texture
```

---

#### Step 4: Detail (optional)

* 카테고리 클릭 시 확장

---

#### Step 5: Intensity 입력

* ●○○○○ (0~4)

---

#### Step 6: Optional note

* 한 줄 메모 or 생략

---

## 9. UI Simplification Strategy

### Key Techniques

* 자동 추천 기반 flavor 표시
* 최근 사용 flavor 우선 노출
* negative flavor 시각적 강조 (red)
* 한 손 조작 UI
* 드릴다운 구조 (category → detail)

---

## 10. Image System

### Storage

```
R2: images/{bottle_id}/{image_id}.jpg
```

---

### Features

* 다중 이미지 per bottle
* 라벨 OCR 가능 (future)
* 자동 후보 추천

---

## 11. OCR / Recognition (Optional)

### Tool

* Google Cloud Vision API

### Flow

1. 이미지 업로드
2. OCR 실행
3. bottle 후보 생성
4. 사용자 선택

---

## 12. Design Philosophy

### 핵심 원칙

* 태그 기반 시스템 금지
* 구조화된 감각 데이터 사용
* UI는 단순, 데이터는 풍부
* 술 종류 확장은 profile로 해결
* 입력 최소화 (취한 상태 기준 UX)

---

## 13. Expected Outcomes

* 개인 취향 데이터 축적
* flavor 기반 분석 가능
* 주류 비교 시스템 구축 가능
* AI 추천 시스템 확장 가능

# Sake Log — 공식 디자인 시스템 가이드 (DESIGN_GUIDE.md)

이 문서는 **사케 전용 테이스팅 저널 (Sake Log)**의 UI/UX 디자인 원칙, 시각 디자인 언어, 컴포넌트 표준 규격 및 레이아웃 제약 사항을 정의한 공식 가이드라인입니다.

---

## 1. 디자인 철학 (Design Philosophy)

> **"오늘 밤의 한 잔, 가장 정갈하게 기록하세요."**

* **Zen Warm Minimalism (정갈한 온기)**:
  * 차갑고 기계적인 다크 테마나 번쩍이는 그라데이션을 지양하고, 일본 전통 화지(和紙, Washi)와 리넨(Linen)의 자연스러운 질감, 앤틱 골드 앰버의 온기를 담아냅니다.
* **Frictionless Mobile-First (취기 속에서도 1분 완결)**:
  * 술을 마시는 현장에서도 한 손으로 1분 내에 사진, 술 이름, 다시 마실 의향을 기록할 수 있도록 모든 입력 인터랙션을 극도로 단순화합니다.
* **Seamless Journal Sheet (단일 양식 시트)**:
  * 여러 단계로 쪼개진 복잡한 마법사(Wizard) 방식을 배제하고, 아날로그 시음 노트 한 장을 작성하듯 자연스럽게 이어지는 단일 시트 경험을 제공합니다.

---

## 2. 컬러 시스템 (Color Palette)

모든 색상은 라이트 테마 전용 CSS 토큰(`var(--...)`)으로 통일하여 사용합니다.

| 토큰명 | 색상값 | 용도 및 설명 |
| :--- | :--- | :--- |
| `--bg-base` | `#f8f5ee` | 앱 전체 배경 (온화한 리넨 베이지) |
| `--bg-surface` | `#ffffff` | 저널 시트, 카드, 모달 표면 배경 |
| `--bg-elevated` | `#f1ebd9` | 입력 필드, 세그먼트 버튼, 서브 컨테이너 |
| `--bg-hover` | `#ece5d3` | 호버 및 포커스 상태 배경 |
| `--border-subtle` | `rgba(45, 38, 25, 0.08)` | 컴포넌트 내부 옅은 구분선 |
| `--border-line` | `rgba(45, 38, 25, 0.14)` | 카드, 시트, 인풋 기본 테두리 |
| `--border-focus` | `#967426` | 포커스 및 활성화 테두리 (앤틱 골드) |
| `--text-primary` | `#1c1812` | 주 텍스트 (깊은 묵색) |
| `--text-secondary` | `#635847` | 보조 텍스트, 라벨, 설명문 |
| `--text-tertiary` | `#998d78` | 플레이스홀더, 힌트 텍스트 |
| `--gold-primary` | `#967426` | 주 브랜드 악센트, 한자 엠블럼 |
| `--gold-soft-bg` | `rgba(150, 116, 38, 0.09)` | 활성 칩, 강조 뱃지 배경 |
| `--gold-glow` | `rgba(150, 116, 38, 0.14)` | 활성 버튼 그림자 효과 |

---

## 3. 타이포그래피 (Typography)

* **서체 조합**:
  * **Serif (`var(--font-serif)`)**: `'Noto Serif KR', serif`
    * 브랜드 로고(`酒 SAKE LOG`), 메인 헤드라인, 사케 이름 입력/출력, 섹션 제목, 엠블럼.
  * **Sans-Serif (`var(--font-sans)`)**: `'Pretendard', -apple-system, sans-serif`
    * 스펙 인라인 그리드, 레이팅 버튼, 특성 태그 칩, 본문 및 메타 정보.
* **계층 구조**:
  * `H1 (Page/Hero Title)`: `1.85rem` ~ `2.15rem`, `font-weight: 700`, `line-height: 1.35`
  * `Sake Title (Card/Detail)`: `1.25rem` ~ `1.45rem`, `font-weight: 700`
  * `Section Heading`: `0.92rem` ~ `1.05rem`, `font-weight: 600`, `letter-spacing: -0.01em`
  * `Body / Spec Label`: `0.82rem` ~ `0.92rem`, `font-weight: 500`

---

## 4. 레이아웃 & 반응형 컨테이너 규격

### 4.1 루트 컨테이너
```css
.app-container {
  width: 100%;
  max-width: 1060px;
  margin: 0 auto;
  padding: 0 16px 80px;
  box-sizing: border-box;
}
```

### 4.2 기록 작성 & 상세 뷰 (Desktop Split View)
* **모바일 (`<960px`)**: 상단 사진 영역 ➔ 하단 단일 저널 시트가 수직으로 자연스럽게 흐름.
* **데스크탑 (`≥960px`)**:
  * 좌측: `sticky-photo-col` (대표 사진 캔버스 + 썸네일 스트립 + '다시 마실까?' 스티키 고정).
  * 우측: `journal-sheet` (기본 정보, 4대 맛 평가, 한줄 메모, 태그, 외부 정보 연속 시트).
  * **상단 기준선 대칭 (Top Baseline)**: 좌측 사진 프레임과 우측 시트의 `padding: 18px; margin: 0;`을 일치시켜 상단이 칼같이 수평 정렬됨.

### 4.3 컬렉션 갤러리 그리드 (명시적 미디어 쿼리)
```css
/* 모바일 (기본) */
.desktop-gallery-3col {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

/* 태블릿 (≥640px) */
@media (min-width: 640px) {
  .desktop-gallery-3col {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* 데스크탑 (≥960px) */
@media (min-width: 960px) {
  .desktop-gallery-3col {
    grid-template-columns: repeat(3, 1fr);
  }
}
```

---

## 5. 컴포넌트 표준 (Component Standards)

### 5.1 사케 이름 & 인라인 스펙 그리드
* 술 이름은 카드 상단에 큼직한 세리프 인풋으로 강조.
* 지역, 양조장, 쌀/정미율, 종류, 도수/일본주도, 용량/가격은 `2열 x 3행`(모바일) ~ `3열 x 2행`(데스크탑)의 단정한 그리드로 묶어 표시.

### 5.2 다시 마실까? (단일 선택 세그먼트)
* **표시값**: `별로` / `잘모르겠음` / `다시 마신다` (저장값: `no` / `unsure` / `yes`)
* 활성화 시 앤틱 골드 배경(`var(--gold-soft-bg)`)과 테두리(`var(--border-focus)`), 은은한 글로우 효과 적용.

### 5.3 4대 축 맛 평가 (Rating Pill Bar)
1. **달콤함 - 드라이함**: 5단계 스텝 버튼 (`아주 달콤함(1)` ~ `아주 드라이함(5)`)
2. **은은함 - 화려함**: 3단계 (`은은한향(1)` / `보통(2)` / `화려한향(3)`)
3. **산미**: 3단계 (`산미없음(1)` / `산미보통(2)` / `산미높음(3)`)
4. **깔끔함 - 감칠맛**: 3단계 (`깔끔함(1)` / `보통(2)` / `감칠맛좋은(3)`)

### 5.4 특성 태그 칩 (Tag Chips)
* 그룹: 맛(`taste`), 향(`aroma`), 느낌(`mood`) 3개 영역으로 분리.
* 각 그룹 끝에 `+` 버튼 배치 (20자 이내 추가 시 즉시 자동 선택).

### 5.5 제로 레코드 랜딩 뷰 (Zen Landing View)
* 모바일 화면 여백(`padding: 48px 24px 64px`)과 뷰포트 높이(`100dvh`) 중앙 정렬.
* 앤틱 골드 대시 테두리의 젠 엠블럼(`酒`) + 풀-위드 둥근 구글 로그인 시트.

---

## 6. 절대 피해야 할 안티패턴 (Layout Pitfalls)

1. **`body`에 `display: flex; align-items: center;` 절대 금지**:
   * 직계 자식인 `.app-container`가 Flex Cross-Axis Alignment에 의해 자식 콘텐츠 너비로 강제 수축(Shrink)되어 500px 모바일 화면으로 쪼그라드는 버그 발생.
   * `body`는 항상 기본 블록 모델을 유지하고, 정렬은 `.app-container`의 `margin: 0 auto;`로 처리합니다.
2. **갤러리 그리드에 `grid-template-columns: repeat(auto-fit, minmax(...))` 사용 금지**:
   * 카드가 1개일 때 그리드가 왼쪽으로 쏠리거나 너비가 불균형해지므로, 반드시 **1열(모바일) / 2열(태블릿) / 3열(데스크탑)**의 명시적 미디어 쿼리를 사용합니다.
3. **불필요한 비주얼 노이즈(이모지, 복잡한 뱃지) 남발 금지**:
   * 헤더나 타이틀에 엔지니어링 상태 아이콘(`☁️`, `💾` 등)을 노출하지 않고, 단아하고 미니멀한 UI를 유지합니다.

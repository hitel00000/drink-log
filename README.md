# Sake Log (사케 테이스팅 로그)

모바일 환경에서 사케를 마실 때 사진, 기본 정보, 맛의 방향, 다시 마실 의향, 장소와 안주 정보를 빠르게 기록하고 안전하게 보관하는 Cloud-first 시음 기록 앱입니다.

시스템 아키텍처 및 도메인 기준 문서는 [CONTEXT.md](CONTEXT.md)입니다.

---

## 🎯 Current Scope

- **간편한 기록 흐름**: `술 이름`만 필수 입력, 나머지는 모두 선택 가능
- **다중 사진 관리**: 대표 이미지 지정 및 자동 썸네일(WebP) 생성
- **판단 & 테이스팅**:
  - 다시 마실까? (`별로`, `잘모르겠음`, `다시 마신다`)
  - 4개 버튼형 평가 축 (달콤-드라이, 은은-화려, 산미, 깔끔-감칠)
  - 한줄 메모 (자유 텍스트)
  - 맛/향/느낌 칩 태그 선택 및 커스텀 태그 실시간 추가/재사용
- **인프라 & 저장**:
  - Cloudflare Pages Functions & Mold Native REST API
  - Cloudflare D1 (Database) & R2 (Image Storage)
  - Google OAuth 2.0 세션 기반 안전한 데이터 격리

---

## 🛠 Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Vanilla CSS
- **Backend**: Cloudflare Pages Functions, Mold Native (Hono REST Router)
- **Data & Storage**: Cloudflare D1 (SQLite), Cloudflare R2 (Object Storage)
- **Authentication**: Google OAuth 2.0 (OpenID Connect)

---

## 📱 Product Flow

새 기록 작성 화면은 [CONTEXT.md](CONTEXT.md)의 플로우를 엄격히 따릅니다:

1. **사진들** ➔ 2. **기본 정보** ➔ 3. **다시 마실까?** ➔ 4. **평가** ➔ 5. **한줄 메모** ➔ 6. **특성 태그** ➔ 7. **외부 정보**

---

## 💻 Development & Validation

Windows PowerShell에서는 `npm.cmd`를 사용합니다:

```powershell
# 의존성 설치
npm.cmd install

# 코드 검증 (3대 필수 검증)
npm.cmd run typecheck
npm.cmd run typecheck:functions
npm.cmd run build

# 로컬 개발 서버
npm.cmd run dev
```

---

## 📚 Project Documents

- **시스템 아키텍처 & 제약조건**: [CONTEXT.md](CONTEXT.md)
- **AI 작업 지침**: [AGENTS.md](AGENTS.md)
- **작업 현황 및 백로그**: [TASKS.md](TASKS.md)
- **D1 스키마**: [docs/schema.sql](docs/schema.sql)
- **운영 설정 및 배포 체크리스트**: [docs/operations-checklist.md](docs/operations-checklist.md)
- **아카이브된 과거 기획서**: [docs/archive/](docs/archive/)

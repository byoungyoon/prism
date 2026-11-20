# Prism

**AI 구독만 있으면, 개발을 몰라도 AI 팀에게 일을 맡길 수 있는 데스크톱 앱.**

하고 싶은 걸 말하면 총괄 AI가 작업 카드로 나눠 팀장·작업자 AI에게 맡기고, 결과를 모아 보여줘요.
Claude · ChatGPT(Codex) · Google Gemini(Antigravity) 구독 로그인으로 동작하고, API 요금은 쓰지 않아요.

## 주요 기능

- **처음 켜면 알아서 준비**: 쓰는 구독을 고르면 필요한 프로그램(Git, Claude Code, Codex, Antigravity)을 공식 설치 프로그램으로 설치하고 로그인까지 안내해요.
- **총괄 → 팀장 → 작업자**: 총괄과만 대화하면 나머지는 하청·보고로 굴러가요. 팀원마다 별도 작업 공간(git worktree)에서 일하고, 윗선이 검토해 합쳐요.
- **터미널 없이**: 모든 AI가 구조화된 모드로 실행돼서, 진행 상황·대화·허락 요청이 카드로 보여요.
- **보고 피드**: 작업마다 실시간 활동과 결과물(바뀐 파일, HTML 미리보기)을 보여줘요.
- **허락은 한곳에서**: 위험할 수 있는 명령은 카드로 모아서 묻고, 안전한 일상 작업은 알아서 진행해요.
- **구독 남은 사용량**: Claude · Codex · Gemini의 5시간·주간 남은 양을 표시해요.
- **이어서 하기**: 앱을 껐다 켜도 팀 기록과 AI 대화가 이어져요.
- **파일 첨부**: 이미지·파일을 끌어다 놓거나 붙여넣어 총괄에게 전달해요.

## 개발

```bash
pnpm install
pnpm tauri dev          # 개발 실행
pnpm tauri build        # 현재 OS용 빌드
```

Windows 설치 파일을 macOS에서 만들기 (cargo-xwin, llvm, lld, nsis 필요):

```bash
PATH=/opt/homebrew/opt/llvm/bin:$PATH pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
```

- 프론트엔드: React 19 · TypeScript · Tailwind 4 · Motion · zustand (`src/`)
- 백엔드: Tauri 2 · Rust (`src-tauri/src/`)
  - `team.rs` 팀/작업 카드 브로커 · `structured.rs` Claude/Codex/Antigravity 드라이버
  - `server.rs` 에이전트용 로컬 MCP 서버 · `launch.rs` CLI별 실행 설정
  - `usage.rs` 구독 사용량 · `clis.rs` 도구 설치/업데이트 · `accounts.rs` 계정
- 설계 문서: `docs/DESIGN.md`, 원본 Orca 분석: `docs/ORCA_ANALYSIS.md`

# 원본 Orca 분석 요약 (Prism 포팅용)

원본: `git@github.com:byoungyoon/orca.git` (stablyai/orca 포크, MIT, v1.4.214)
규모: TS 약 31,000 파일. Electron 43 + React 19 + zustand 5 + Tailwind 4/shadcn + xterm.js + Monaco.

## 1. 원본 아키텍처

| 프로세스 | 역할 | 주요 경로 |
|---|---|---|
| Electron main | GUI 셸, IPC 핸들러 | `src/main/index.ts`, `src/main/ipc/*` |
| Backend service | 별도 Node 프로세스, MessagePort RPC | `src/main/backend/` |
| Terminal daemon | PTY 소유(앱 재시작해도 유지), Unix socket + NDJSON/바이너리 프레이밍 | `src/main/daemon/` |
| orcad | 원격 실행용 헤드리스 서버 | `src/main/orcad/` |
| Renderer | React UI, `window.api.*`로 백엔드 호출 | `src/renderer/src`, `src/preload` |

**Prism에서는 이 구조를 Tauri Rust 프로세스 하나로 합친다.**

## 2. 핵심 도메인

### Worktree
- `git` CLI를 직접 실행한다 (libgit2를 쓰지 않음).
  - 생성: `git worktree add --no-track -b <branch> <path> <base>` (`src/main/git/worktrees/creation/worktree-add.ts`)
  - 목록: `git worktree list --porcelain` (`src/shared/git/worktrees/git-worktree-porcelain-parser.ts`)
- 모델:
  - `Repo { id, path, displayName, badgeColor, worktreeBaseRef, kind }`
  - `Worktree { id = "${repoId}::${path}", repoId, displayName, isArchived, isPinned, isUnread, sortOrder, ... }`
- git에서 나오지 않는 정보는 `WorktreeMeta`로 따로 저장하고, git 목록과 합쳐서 화면에 보여준다.

### 에이전트 실행
- 카탈로그: `src/shared/agent-launch/catalog/tui-agent-config.ts`
  - 항목: `detectCmd`, `launchCmd`, `promptInjectionMode(argv | stdin-after-start)`
- 실행 방식: PTY 셸에 `claude "<prompt>"`를 입력하는 것과 같다. 권한 플래그는 `--permission-mode ...`이다.

### 에이전트 상태 감지
- 상태 값: `working | blocked | waiting | done`
- 감지 경로 1, **Hook(우선)**:
  - 각 에이전트 설정(Claude는 config dir의 `settings.json`)에 hook을 설치한다 (`src/main/claude/hooks/`).
  - hook이 loopback HTTP 서버로 POST한다 (`src/main/agent-hooks/server/`).
  - PTY에 env `ORCA_AGENT_HOOK_PORT/TOKEN`, `ORCA_PANE_KEY`를 넣어서 어느 pane의 이벤트인지 연결한다.
- 감지 경로 2, **OSC 7501**: PTY 출력에 섞인 이스케이프 시퀀스를 파싱한다 (`src/shared/program-status/`). Hook이 없을 때의 폴백이다.
- `blocked` 상태가 되면 데스크톱 알림을 보낸다 (`src/main/notifications/`).

### orca.yaml (레포별 설정)
- `scripts.setup`: worktree 생성 후 실행
- `scripts.archive`: 아카이브 전 실행
- `defaultTabs[] {title, color, command}`
- `worktree.sharedDirectories`
- 실행 전에 사용자에게 신뢰 여부를 묻는다.

### Claude 프로필
- `<dataRoot>/claude-profiles/<id>/home`을 **`CLAUDE_CONFIG_DIR`**로 지정해서 계정별 로그인을 분리한다.
- 관련 코드: `src/main/claude-accounts/`

### 저장소
- 예전에는 `orca-data.json`, 지금은 SQLite에 domain별 JSON 문서로 저장한다 (`src/main/persistence/`).

### Renderer ↔ Backend
- `window.api.{repos, worktrees, pty, git, settings}` 형태다.
- 요청은 invoke로, 이벤트는 unsubscribe를 돌려주는 subscribe로 처리한다. Tauri의 `invoke`/`listen`과 1:1로 대응된다.
- pty API:
  - `spawn({cols, rows}) -> {id}`
  - `write`, `resize`, `kill`
  - `onData`, `onExit`, `ackData`(backpressure)

## 3. Prism MVP 설계

### Rust (src-tauri)
- `pty`: `portable-pty`로 로그인 셸을 띄우고 write/resize/kill을 처리한다. 출력은 Tauri `Channel`로 스트리밍하고, ring buffer로 scrollback을 보관한다.
- `git`: `std::process::Command`로 worktree add/list/remove, status, diff를 실행한다.
- `store`: `app_data_dir/state.json`에 원자적으로 쓴다 (`serde_json` + tempfile rename).
- `agents`: claude/codex 카탈로그와 `which` 기반 감지.
- (P1) `hooks`: 127.0.0.1 HTTP 리스너와 Claude hook 설치.

### Frontend (src)
- React 19, zustand, Tailwind 4, shadcn
- `@xterm/xterm` + fit, webgl, web-links
- 레이아웃: 좌측 사이드바(레포/worktree) + 중앙 터미널 탭 + 우측 변경 파일/diff(Monaco DiffEditor, lazy load)
- 백엔드 호출은 `src/lib/api.ts` 한 곳에서 감싼다.

### 단계
| 우선순위 | 범위 |
|---|---|
| P0 | PTY 터미널 탭, 레포 추가, worktree 생성/삭제, Claude 실행, git diff 보기 |
| P1 | hook 기반 상태 표시와 알림, orca.yaml setup 스크립트, split pane, Claude 프로필 |
| P2 (생략) | daemon 분리, SSH/WSL/클라우드, 모바일, 네이티브 챗(ACP), 브라우저, 플러그인, 봇, GitHub/Linear 연동 |

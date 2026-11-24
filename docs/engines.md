# 엔진 (figcraft)

Prism이 쓰는 외부 디자인 엔진 figcraft의 웹판 빌드, 화면 확인, AI(MCP) 연동 방법을 정리합니다.
figcraft 원본 저장소는 읽기만 하고, 여기서 만든 산출물은 이 저장소 밖(또는 gitignore된 `public/`)에만 둡니다.

## 1. 웹판 빌드

figcraft의 `apps/figcraft-web`을 trunk로 빌드해 `public/engines/figcraft/`에 넣습니다.

```bash
scripts/build-engine-figcraft.sh
FIGCRAFT_DIR=/path/to/figcraft scripts/build-engine-figcraft.sh   # 저장소 위치가 다를 때
```

- 필요한 것: `trunk`(`cargo install trunk`), Rust `wasm32-unknown-unknown` 타깃(`rustup target add wasm32-unknown-unknown`).
- 기본 figcraft 경로는 `/Users/byoungyoonlee/orca/projects/test/figcraft`입니다. `FIGCRAFT_DIR`로 바꿀 수 있습니다.
- `trunk build --release --dist <이 저장소>/public/engines/figcraft`로 실행합니다. figcraft의 `Trunk.toml`에 있는 `dist`(`../../dist/web`)는 `--dist`가 덮어씁니다.
- Cargo 빌드 캐시는 `CARGO_TARGET_DIR`(기본 `~/.prism/cache/figcraft-target`)에 둡니다. figcraft 안의 `target/`에는 쓰지 않습니다.
- 산출물(`public/engines/figcraft/`, 약 47 MB: wasm 24 MB 포함)은 `.gitignore`에 들어 있어 커밋하지 않습니다. 빌드는 figcraft의 **현재 작업 트리 상태**를 그대로 씁니다(커밋되지 않은 변경 포함).

### 검증 결과 (2026-11-24)

- `scripts/build-engine-figcraft.sh` 빌드 성공(`web-release` 프로필, 약 6분). 산출물: `index.html`, `figcraft-web-*.js`, `figcraft-web-*_bg.wasm`, `snippets/`.
- figcraft 저장소: 빌드 전후 `git status`가 같습니다. 산출물이 figcraft 안에 남지 않았습니다. 다만 `.trunk-lock`(0바이트)은 `public/engines/figcraft/` 안에 생기므로, 필요 없으면 지워도 됩니다.
- 개발 서버 확인: 테스트용 최소 vite 설정으로 `vite` 바이너리(`/Users/byoungyoonlee/orca/projects/myOrca/node_modules/.bin/vite`, pnpm 미사용)를 띄워 확인했습니다. worktree에는 `node_modules`가 없어서 임시 설정을 썼습니다. 저장소 안에서 띄우면 기본 `vite.config.ts`를 그대로 씁니다.
  - `http://127.0.0.1:<port>/engines/figcraft/index.html?control` → 200, `window.figcraft`가 `object`로 준비됨, 로딩 오버레이 제거, 콘솔 오류 없음.
  - `window.figcraft.inspect()`가 응답: `{"name":"Untitled","pages":[{"name":"Page 1",...}],...}`.
  - 화면 스크린샷으로 figcraft 편집기 UI가 그려지는 것을 확인했습니다(기본 WebGPU 경로).
  - `?control&webgl`(WebGL2 강제)도 같은 결과입니다.
  - 확인에 쓴 Chrome은 별도 프로필(`/tmp/t20-chrome-profile`)로 띄우고 끝나면 종료했습니다.
- figcraft 쪽 수정은 필요 없었습니다.

## 2. figcraft-cli 설치 (AI 연동용)

`figcraft-cli`는 figcraft 릴리스 zip(`figcraft/dist/release/figcraft-cli-0.12.1-macos-aarch64.zip`)에 들어 있습니다. 원본은 건드리지 않고 Prism 데이터 폴더에 풀어 씁니다.

```bash
scripts/install-figcraft-cli.sh
# 설치 위치: ~/.prism/engines/figcraft/figcraft-cli
```

- zip을 빈 임시 폴더에 풀고 바이너리 하나만 복사합니다. 설치 후 `--help`와 `--version`(0.12.1)을 확인합니다.
- `FIGCRAFT_CLI_ZIP`, `PRISM_ENGINE_DIR`로 zip 경로와 설치 위치를 바꿀 수 있습니다.

## 3. AI 에이전트가 figcraft MCP를 쓰는 설정

figcraft는 MCP 서버를 내장합니다(`docs/mcp.md`). 헤드리스 모드는 창 없이 엔진 세션을 하나 돌립니다. 파일을 열고 `save_file`로 저장하면 그 `.figcraft` 파일이 바뀝니다.

MCP 클라이언트 설정 예시(절대 경로를 적으세요. JSON 안에서 `~`는 펼쳐지지 않습니다):

```json
{
  "mcpServers": {
    "figcraft": {
      "command": "/Users/<사용자>/.prism/engines/figcraft/figcraft-cli",
      "args": ["mcp", "--automation-read-root", "/path/to/작업폴더", "--automation-write-root", "/path/to/작업폴더"]
    }
  }
}
```

- `--automation-read-root`와 `--automation-write-root`는 에이전트가 읽고 쓸 수 있는 폴더를 제한합니다. 둘 다 같은 작업 폴더로 두면 됩니다. 쓰기 권한이 없으면 디스크에 쓸 수 없습니다.
- 폴더는 미리 있어야 합니다. 없으면 서버가 시작하지 않습니다.
- 에이전트는 `open_file {path}`로 열고, `get_node`/`set_properties`/`run_command`로 편집하고, `save_file {}`로 저장합니다.
- 저장된 파일을 Prism이 감지해 화면에 반영한다는 부분은 이번 작업 범위에서 확인하지 않았습니다. Prism 쪽 파일 감지 동작은 별도로 확인이 필요합니다.
- 주의: 실제 연결 대상은 `figcraft-cli mcp --attach <포트>`(떠 있는 figcraft 앱을 조작)와 헤드리스의 두 가지입니다. 아래 시험은 헤드리스입니다.

### 헤드리스 MCP 편집·저장 시험 (2026-11-24)

원본은 건드리지 않고 임시 작업 폴더에 `examples/ridgeline-app.figcraft`를 복사해 시험했습니다.

1. `figcraft-cli mcp --automation-read-root <작업폴더> --automation-write-root <작업폴더>`를 stdio로 실행. 줄 단위 JSON-RPC.
2. `initialize` → 서버 `figcraft 0.12.1`, 프로토콜 `2025-06-18` 응답.
3. `tools/call open_file {path: <작업폴더>/ridgeline-app.figcraft}` → 열림(페이지 1, 노드 349 SECTION, 노드 68 FRAME "Home — Light" 등). 누락 폰트 경고: Inter(79개 레이어).
4. `get_node {id: 68}` → 채우기 `#F4F6F8`.
5. `set_properties {ids: [68], props: {fills: [{type: "solid", color: "#FF0000"}]}}` → `ok: true`, 채우기 빨강으로 변경.
6. `save_file {}` → 65,430 바이트 저장, 오류 없음. 종료 코드 0.
7. 저장 파일을 zip으로 풀어 `document.json`을 파싱해 확인: 노드 68의 채우기가 빨강(r 1.0, g 0, b 0)으로 저장됨. 원본 예제 채우기는 `F4F6F8`로 그대로이고, 원본 파일 SHA-256도 바뀌지 않았습니다.
8. `figcraft-cli info <저장 파일> --json`도 정상 응답(노드 수 349, 프레임 목록 포함).

참고: `.figcraft`는 zip 파일입니다. 안에는 `document.json`(문서 본문, 약 370 KB)과 `thumbnail.png`가 들어 있습니다. 색은 hex가 아니라 0~1 실수 RGB로 저장되므로, 파일을 직접 검색할 때 `FF0000` 같은 문자열로는 찾을 수 없습니다.

재현 방법(요약):

```bash
W=$(mktemp -d) && cp /path/to/figcraft/examples/ridgeline-app.figcraft "$W/"
# 위 1~6 단계를 stdio JSON-RPC 로 실행: initialize → notifications/initialized → tools/call
#   open_file → set_properties(ids [68]) → save_file
unzip -p "$W/ridgeline-app.figcraft" document.json > "$W/doc.json"
# doc.json 에서 id 68 노드의 fills 를 확인 (색은 0~1 실수 RGB)
~/.prism/engines/figcraft/figcraft-cli info "$W/ridgeline-app.figcraft" --json
```

## 4. 알려진 제한

- figcraft 작업 트리에 커밋되지 않은 변경이 많습니다(빌드 시점 기준 36개 항목). 빌드 결과는 그 상태를 반영합니다. 원본 저장소 쪽 정리는 이 작업 범위가 아닙니다.
- WebGPU/WebGL2가 필요합니다. 헤드리스 Chrome에서는 두 경로 모두 로드를 확인했지만, 실제 GPU 성능은 확인하지 않았습니다.
- 예제 파일은 Inter 폰트가 없는 환경에서 경고를 냅니다. 저장 자체는 막지 않습니다.

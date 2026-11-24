# DeckCraft 엔진 (pptx)

DeckCraft는 pptx를 다루는 엔진이다. 두 가지 형태로 쓴다.

- **웹판**: 브라우저에서 도는 빌드. 프런트 어댑터는 `window.deckcraft`로 조작하고 바이트를 주고받는다.
- **CLI**: `deckcraft-cli mcp`로 headless 실행. 에이전트가 stdio로 pptx를 열고 고친다.

소스는 `/Users/byoungyoonlee/orca/projects/test/deckcraft` (읽기 전용으로 쓴다. 수정·커밋 금지).

## 1. 웹판 빌드와 로드

```sh
scripts/build-engine-deckcraft.sh          # → public/engines/deckcraft/ (git 무시, 커밋 금지)
DECKCRAFT_DIR=/path/to/deckcraft scripts/build-engine-deckcraft.sh   # 저장소 위치 변경
```

- 빌드는 `apps/deckcraft-web`에서 `trunk build --release --dist <이 저장소>/public/engines/deckcraft`를 실행한다.
- cargo 산출물은 `CARGO_TARGET_DIR`(기본 `~/.cache/prism/deckcraft-target`)에 쌓이므로 deckcraft 저장소 안에는 아무것도 남지 않는다.
- 로드: `/engines/deckcraft/index.html`. `?control` 쿼리는 필요 없다. `window.deckcraft`는 쿼리와 상관없이 항상 설치된다(presenter 팝업만 제외).
- 웹판 쿼리 플래그: `?webgl`(WebGL2 강제), `?blank`(빈 문서로 시작. 없으면 샘플 덱), `?show`(슬라이드쇼 시작), `?host=parent`(같은 출처의 부모 페이지와 바이트 교환, 아래 3절), `&author=이름`(주석 작성자).

검증 (2026-11-24, vite dev `127.0.0.1:5199`, Playwright headless shell + SwiftShader):
- `/engines/deckcraft/index.html` 로드 성공. `window.deckcraft` 존재, 함수 6개, 명령 383개, 샘플 덱 8장.
- 콘솔 경고는 "Software rasterizer detected"(정보성)와 `integrity` preload 경고뿐이고 에러는 없음.

## 2. `window.deckcraft` API

모든 함수는 Promise를 돌려준다. 실패하면 reject되고 `Error.message`에 원인이 들어간다(예: `unknown command \`no.such.command\``). 호출 하나당 제한 시간은 30초.

| 함수 | 호출 예 | 결과 | 비고 |
|---|---|---|---|
| `execute(command, params)` | `execute("file.saveBytes", {format: "pptx"})` | 명령 결과 | 엔진 명령 전부. 열기·저장도 여기서 한다 |
| `request(method, params)` | `request("document.inspect", {})` | 제어 응답의 `result` | 제어 메서드 원시 호출. 경로 기반 `app.open`은 웹에서 거절된다 |
| `commands()` | `commands()` | 명령 목록 | 각 항목: `id, label, menu, shortcut, params, enabled` |
| `docInspect(params)` | `docInspect({})` | `title, path, dirty, slides, sections, layouts, selection, fonts, theme, undo, redo` 등 | 문서 상태 |
| `uiInspect(params)` | `uiInspect({})` | UI 상태 (`tool, dialog, home, backstage, showing, ...`) | |
| `screenshot(params)` | `screenshot({})` | `{data, png, width, height}` | `data`와 `png`는 base64 PNG |

## 3. 열기·저장 (바이트)

웹판에는 파일 경로가 없다. 바이트는 아래 두 경로 중 하나로 주고받는다.

### 3-1. 페이지 안에서 (`execute`) — 가장 간단한 경로

| 하는 일 | 호출 | 주고받는 값 |
|---|---|---|
| pptx 열기 | `execute("file.openBytes", {name: "deck.pptx", data: base64})` | `data`는 base64 문자열. 응답: `{document, missingFonts, importWarnings, lostSlides, damagedMedia}` |
| pptx 바이트 얻기 | `(await execute("file.saveBytes", {format: "pptx"})).data` | base64 문자열 |
| 네이티브 형식 얻기 | `execute("file.saveBytes", {format: "deckcraft"})` | 같음 |

base64라서 원본보다 약 33% 커진다. 아래 3-2 경로는 `ArrayBuffer`를 그대로 넘긴다.

### 3-2. 호스트 브리지 (iframe 또는 같은 문서)

엔진이 파일을 직접 다루지 않고 호스트 페이지가 보관할 때 쓴다. 메시지 이름은 `deckcraft:<종류>`다.

| 방향 | 메시지 | 필드 | 설명 |
|---|---|---|---|
| 호스트 → 엔진 | `deckcraft:open` | `name`(파일 이름, 없으면 제목 없는 문서), `bytes`(`ArrayBuffer` 또는 `Uint8Array`) | 이름이 `.pptx/.potx/.ppsx/.deckcraft`면 저장 시 같은 이름으로 돌아간다 |
| 엔진 → 호스트 | `deckcraft:ready` | `version, appVersion, file`(false: 바이트로 보내라) | 엔진이 준비되면 한 번 보낸다. 이때 파일을 보낸다 |
| 엔진 → 호스트 | `deckcraft:save` | `name, bytes`(`ArrayBuffer`, 전송됨), `saveAs`(bool) | `saveAs:false`는 열었던 파일 그대로 저장, `true`는 다른 이름으로 저장 |
| 엔진 → 호스트 | `deckcraft:dirty` | `dirty`(bool) | 저장 안 된 변경이 생기거나 사라질 때 |
| 엔진 → 호스트 | `deckcraft:failed` | 오류 문장 | 시작 실패, 2 GiB 이상 파일 |

전달 방식은 두 가지다.

- **iframe** (`?host=parent`): 같은 출처의 부모 페이지가 `iframe.contentWindow.postMessage({type: "deckcraft:open", name, bytes}, origin, [buffer])`로 보낸다. 엔진의 응답은 부모 창의 `message` 이벤트로 온다. 출처가 다르면 브리지가 꺼진다.
- **같은 문서** (`data-host="page"`): 캔버스 `#deckcraft_canvas`에 `data-host="page"` 속성이 있어야 한다. 메시지는 캔버스의 `CustomEvent`다(`canvas.dispatchEvent(new CustomEvent("deckcraft:open", {detail: {name, bytes}}))`). **현재 빌드된 `index.html`에는 이 속성이 없다.** 같은 문서 방식을 쓰려면 속성을 넣은 빌드가 필요하다(아래 5절).

시험 결과 (같은 문서 방식, 속성은 Playwright 라우트로 주입): `deckcraft:open`에 `ArrayBuffer`와 이름 `sample.pptx`를 주면 문서 8장이 열리고 경로가 `sample.pptx`가 된다. `file.save`를 실행하면 `deckcraft:save`가 `{name: "sample.pptx", saveAs: false}`와 PK(zip) 시그니처의 37,219바이트를 준다.

### 3-3. 확장자

| 확장자 | 열기 | 저장 | 근거 |
|---|---|---|---|
| `.pptx` | 확인 (3-1 시험) | 확인 (`format: "pptx"`) | 시험 |
| `.deckcraft` | 파일 선택 목록에 있음 | `format: "deckcraft"` | 소스 (`web.rs`, `file.saveBytes` 인자) |
| `.potx` `.ppsx` | 파일 선택 목록에 있음 | 같은 이름으로 저장 시 `.pptx` 형식 | 소스 (`host.rs`). 미시험 |
| `.ppt` `.pot` `.pps` | 파일 선택 목록에 있음 | 미확인 | 소스만 확인, 미시험 |
| `.txt` `.md` | 아웃라인으로 열리며 제목 없는 문서 | 미확인 | 소스 (`host.rs`). 미시험 |

저장 형식 인자는 `deckcraft | pptx`만 받는다(`file.saveBytes`). PDF·PNG·GIF 등은 `file.export`로 만든다.

## 4. 한계

- 웹판은 파일 경로가 없다. `request("app.open", {path})`는 "use file.openBytes in the browser"로 거절된다(확인함). 경로 기반 열기·저장은 쓰지 말고 `execute("file.openBytes", …)`와 `execute("file.saveBytes", …)`를 쓴다.
- 호스트가 보내는 파일은 2 GiB 미만이어야 한다. 그 이상은 `deckcraft:failed`.
- 기본 설정(환경설정)은 저장되지 않는다.
- 번들 폰트가 없다(5절). 샘플을 열면 `missingFonts`에 Inter, Arial이 뜬다.

## 5. 빌드 주의와 deckcraft 쪽 메모 (수정하지 않음)

- `craft-fonts`가 deckcraft 옆(`../craft-fonts`)에 없어서 웹 빌드는 폰트 없이 만들어졌다(`building without craft-fonts` 경고). 폰트가 필요하면 저장소를 그 자리에 두거나 `CRAFT_FONTS_DIR`을 지정하고 다시 빌드한다.
- `apps/deckcraft-web/index.html`의 캔버스에 `data-host="page"`가 없다. iframe 방식(`?host=parent`)은 그대로 동작한다. 같은 문서 방식을 쓰려면 빌드 뒤 캔버스 태그에 속성을 넣거나 deckcraft 쪽 `index.html`에 넣는 변경이 필요하다. 이번 작업에서는 고치지 않았다.

## 6. CLI (`deckcraft-cli mcp`)

설치: `scripts/install-deckcraft-cli.sh` → `~/.prism/engines/deckcraft/deckcraft-cli` (소스 빌드, 0.19.0, 약 33 MB). 릴리스 자산 대신 체크아웃된 소스를 빌드한다. 최신 릴리스(v0.18.1)는 소스(0.19.0)보다 오래됐다. `SKIP_SMOKE=1`로 설치만 할 수 있다.

MCP 서버 실행 (stdio, 줄 단위 JSON-RPC). 읽기·쓰기 폴더를 지정해 접근을 가둔다.

```sh
~/.prism/engines/deckcraft/deckcraft-cli mcp --automation-read-root /work/project --automation-write-root /work/project/out
```

편집 시험 (`scripts/deckcraft-mcp-smoke.mjs`, 2026-11-24, 전 항목 통과):

| 단계 | 도구 | 결과 |
|---|---|---|
| 핸드셰이크 | `initialize` | 성공 |
| 열기 | `open_presentation {path}` | 성공 (샘플 덱 8장) |
| 도형 찾기 | `inspect_slide {index: 0}` | 텍스트가 있는 도형 (id 258, "Northern Lights") |
| 텍스트 바꾸기 | `set_text {id, text}` | 성공. 같은 세션에서 다시 읽으면 바뀐 글자 확인 |
| 저장 | `save_presentation {path}` (쓰기 폴더 안) | 성공. PK 시그니처 확인 |
| 가둠 확인 | `save_presentation` (쓰기 폴더 밖) | 거부: `automation path rejected: outside the write roots …` |
| 디스크 재확인 | `deckcraft-cli convert` 후 텍스트 검색 | 바꾼 글자가 파일에 있음 |

시험 실행: `node scripts/deckcraft-mcp-smoke.mjs CLI IN.pptx OUT_DIR`. 종료 코드 0이면 통과.

`open_presentation`과 `save_presentation`은 내부에서 `file.open`, `file.save` 명령으로 연결된다(`crates/mcp/src/tools.rs`). 웹판 경로는 별도로 시험했다. 3-1에서 `file.openBytes`로 열고, 도형을 넣고, `file.saveBytes`로 받은 파일을 CLI로 읽어 `Hello T23` 문자열이 들어간 것을 확인했다.

## 7. 팀원이 deckcraft를 쓰는 설정

Prism은 `deckcraft-cli`를 `PRISM_DECKCRAFT_CLI`(있을 때) 또는 `~/.prism/engines/deckcraft/deckcraft-cli`에서 찾고, 파일이 실제로 있을 때만 에이전트에 `deckcraft` MCP 서버를 연결한다. Claude는 `--mcp-config`, Codex는 `-c mcp_servers.deckcraft.*` 설정으로 같은 명령(`deckcraft-cli mcp --automation-read-root <작업폴더> --automation-write-root <작업폴더>`)을 받는다. 읽기·쓰기 폴더는 에이전트의 작업 폴더 하나로 제한된다. 이 서버는 쓰기 도구라 자동 허용 목록(`SAFE_TOOLS`)에는 넣지 않았으므로, 도구를 쓸 때마다 Prism의 허가 흐름을 거친다. CLI가 없으면 연결이 생기지 않고 기존 동작과 같다. 설치는 `scripts/install-deckcraft-cli.sh`로 한다.

// 팀원 고양이를 우클릭하면(터치 화면은 길게 누르면) 뜨는 작은 메뉴. 이름을 바꾸거나 '원래 이름으로' 되돌리고,
// 상점에서 가진 털색(흰색은 처음부터) 중에서 고르며, '자동으로 되돌리기'로 이름에 따른 자동 배정으로 돌아간다.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { isRemote } from "../lib/transport";
import { CAT_NAME_MAX, catName, coatKey, coatOf, COATS, givenName } from "./critters/pixel/coats";
import { CatPicture } from "./ShopSheet";

/** 손가락을 이만큼 대고 있으면 메뉴가 열린다 */
const HOLD_MS = 500;
/** 그 사이에 이보다 더 움직이면 끌기·스크롤이다 (Office.tsx의 DRAG_PX보다 크지 않게) */
const HOLD_SLOP = 5;

interface At {
  key: string;
  x: number;
  y: number;
}

/**
 * 그 자리의 팀원 고양이. 사무실과 편집 화면의 고양이는 클릭이 지나가는 층(pointer-events: none)에 있어서
 * 좌표로 찾는다. 사무실 고양이는 사무실을 눌렀을 때만 (위에 뜬 창이나 허락 말풍선을 누른 것은 아니다).
 */
function catKeyAt(e: MouseEvent): string | null {
  const target = e.target as Element;
  const own = target.closest<HTMLElement>("[data-coat-key]");
  if (own) return own.dataset.coatKey!;
  if (target.closest(".of-ask, [role=dialog], [role=alertdialog], input, textarea")) return null;
  let hit: { key: string; bottom: number } | null = null;
  for (const el of document.querySelectorAll<HTMLElement>("[data-coat-key]")) {
    const room = el.closest(".of-room");
    if (room ? !room.contains(target) : !el.closest('[data-critter-layer="app"]')) continue;
    if (el.closest(".cr-leaving")) continue;
    const r = el.getBoundingClientRect();
    // 그림 칸에는 빈 곳이 있어서 안쪽만 본다. 겹치면 앞(아래쪽)에 선 고양이
    const on = e.clientX >= r.left + r.width * 0.2 && e.clientX <= r.right - r.width * 0.2 && e.clientY >= r.top + r.height * 0.1 && e.clientY <= r.bottom;
    if (on && (!hit || r.bottom > hit.bottom)) hit = { key: el.dataset.coatKey!, bottom: r.bottom };
  }
  return hit?.key ?? null;
}

export function CoatMenu() {
  const [at, setAt] = useState<At | null>(null);
  useEffect(() => {
    // 다른 기기(원격 접속)에서는 저장할 수 없어서 메뉴를 띄우지 않는다 (개발 서버는 화면 캡처 도구가 이 경로를 써서 둔다)
    if (isRemote && !import.meta.env.DEV) return;
    // 길게 누르기: 우클릭(contextmenu)이 없는 터치 화면(iOS)에서도 열리게
    let press: { id: number; x: number; y: number; timer: number } | null = null;
    const cancel = () => {
      if (press) window.clearTimeout(press.timer);
      press = null;
    };
    // 길게 누른 손가락을 뗄 때 따라오는 클릭은 버린다 (책상이 눌려 작업 화면이 열리지 않게). 다음에 누를 때 푼다
    const eat = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      release();
    };
    const release = () => {
      window.removeEventListener("click", eat, true);
      window.removeEventListener("pointerdown", release, true);
    };
    const down = (e: PointerEvent) => {
      cancel();
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      const key = catKeyAt(e);
      if (!key) return;
      const { pointerId: id, clientX: x, clientY: y } = e;
      const timer = window.setTimeout(() => {
        press = null;
        // 사무실이 그 고양이를 집고 있던 것은 놓게 한다 (손가락을 계속 움직여도 끌리지 않게)
        window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: id }));
        window.addEventListener("click", eat, true);
        window.addEventListener("pointerdown", release, true);
        setAt({ key, x, y });
      }, HOLD_MS);
      press = { id, x, y, timer };
    };
    const move = (e: PointerEvent) => press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > HOLD_SLOP && cancel();
    const end = (e: PointerEvent) => press?.id === e.pointerId && cancel();
    const open = (e: MouseEvent) => {
      const key = catKeyAt(e);
      if (!key) return;
      e.preventDefault();
      cancel();
      setAt({ key, x: e.clientX, y: e.clientY });
    };
    window.addEventListener("contextmenu", open);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    return () => {
      cancel();
      release();
      window.removeEventListener("contextmenu", open);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
    };
  }, []);
  return at ? <Menu key={`${at.key}:${at.x}:${at.y}`} at={at} close={() => setAt(null)} /> : null;
}

function Menu({ at, close }: { at: At; close: () => void }) {
  const teams = useApp((s) => s.teams);
  const projects = useApp((s) => s.projects);
  const owned = useApp((s) => s.owned);
  const picked = useApp((s) => s.coats[at.key]);
  const setCoat = useApp((s) => s.setCoat);
  const renamed = useApp((s) => s.catNames[at.key]);
  const setCatName = useApp((s) => s.setCatName);
  /** 이름을 입력하는 중이면 적고 있는 글 */
  const [draft, setDraft] = useState<string | null>(null);
  const [wrong, setWrong] = useState("");
  const editing = draft !== null;
  const renameButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    // 취소하면 '이름 바꾸기' 버튼으로 돌아온다
    if (wasEditing.current && !editing) renameButton.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  const [resized, setResized] = useState(0);

  const found = Object.values(teams)
    .flatMap((t) => t.agents.map((agent) => ({ agent, team: t })))
    .find((m) => coatKey(m.agent) === at.key);

  // 창 밖으로 나가지 않게
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = (v: number, size: number, max: number) => Math.max(8, Math.min(v, max - size - 8));
    setPos({ left: fit(at.x, el.offsetWidth, window.innerWidth), top: fit(at.y, el.offsetHeight, window.innerHeight) });
  }, [at, owned, editing, wrong, renamed, resized]);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    const outside = (e: Event) => !box.current?.contains(e.target as Node) && close();
    const keys = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement && !!box.current?.contains(e.target);
      if (e.key === "Escape") {
        e.stopPropagation();
        // 이름을 적는 중이면 입력만 취소한다 (한글 조합 중의 Esc는 조합을 끝내는 것)
        if (!typing) close();
        else if (!e.isComposing) {
          setDraft(null);
          setWrong("");
        }
        return;
      }
      if (typing) return; // 화살표는 글자 사이를 옮긴다
      const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + step + items.length) % items.length].focus();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", keys, true);
    // 휴대폰은 글자판이 올라오면 창 크기가 바뀐다: 이름을 적는 중에는 닫지 않고 자리만 맞춘다
    const resize = () => (document.activeElement instanceof HTMLInputElement && box.current?.contains(document.activeElement) ? setResized((n) => n + 1) : close());
    window.addEventListener("resize", resize);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 그 팀원이 사라졌으면 메뉴도 닫는다
  useEffect(() => {
    if (!found) close();
  }, [found, close]);
  if (!found) return null;

  const { agent, team } = found;
  const project = projects.find((p) => p.id === team.projectId)?.name ?? team.projectName;
  // 총괄의 자동 털색은 팀(프로젝트) 이름으로 정한다 (Office.tsx의 colorKey와 같게)
  const now = coatOf(agent.role === "lead" ? project : agent.name, agent.role, at.key);
  const choices = COATS.filter((c) => owned.includes(`cat:${c.id}`) || c.id === "white");
  const who = givenName(agent) ?? (agent.role === "lead" ? `${project} 총괄` : catName(agent));
  const length = [...(draft ?? "").trim()].length;
  const save = () => {
    const name = (draft ?? "").trim();
    if (!name) return setWrong("이름을 한 글자 이상 적어 주세요");
    if (length > CAT_NAME_MAX) return setWrong(`이름은 ${CAT_NAME_MAX}자까지 지을 수 있어요`);
    // 보이는 이름 그대로면 바꾼 것이 없다 (털색에 맞는 별명을 고정해 버리지 않게)
    if (name !== catName(agent)) void setCatName(at.key, name);
    close();
  };
  const choose = (coat: string | null) => {
    void setCoat(at.key, coat);
    close();
  };

  return (
    <div
      ref={box}
      role="menu"
      aria-label={`${who} 이름·털색 바꾸기`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="fixed z-[60] flex max-h-[min(440px,calc(100%-16px))] w-[304px] max-w-[calc(100%-16px)] flex-col gap-2 rounded-2xl p-2.5"
      style={{ ...pos, background: "var(--bg1)", color: "var(--text)", border: "1px solid var(--line)", boxShadow: "0 12px 32px rgb(0 0 0 / 0.22)" }}
    >
      <span className="shrink-0 truncate px-1 text-[12.5px] font-semibold">{who}</span>
      {editing ? (
        <div className="flex shrink-0 flex-col gap-1">
          <div className="flex gap-1.5">
            <input
              autoFocus
              aria-label="새 이름"
              aria-invalid={!!wrong || length > CAT_NAME_MAX}
              value={draft}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setDraft(e.target.value);
                setWrong("");
              }}
              onKeyDown={(e) => {
                // 한글을 조합하는 중의 Enter는 글자를 끝내는 것이다
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  save();
                }
              }}
              enterKeyHint="done"
              autoComplete="off"
              spellCheck={false}
              className="min-h-8 min-w-0 flex-auto rounded-lg bg-transparent px-2 text-[16px] outline-none"
              style={{ border: "1.5px solid var(--amber)" }}
            />
            <button onClick={save} className="min-h-8 shrink-0 rounded-full px-3 text-[12px] font-semibold" style={{ border: "1px solid var(--line)" }}>
              저장
            </button>
          </div>
          <span role={wrong ? "alert" : undefined} className="px-1 text-[11.5px] text-ink-2" style={wrong || length > CAT_NAME_MAX ? { color: "var(--block-ink)" } : undefined}>
            {wrong || `${length}/${CAT_NAME_MAX}자 · Enter 저장 · Esc 취소`}
          </span>
        </div>
      ) : (
        <div className="flex shrink-0 gap-1.5">
          <button ref={renameButton} role="menuitem" onClick={() => setDraft(catName(agent))} className="min-h-8 flex-1 rounded-full px-3 text-[12px] font-medium" style={{ border: "1px solid var(--line)" }}>
            이름 바꾸기
          </button>
          {renamed && (
            <button
              role="menuitem"
              onClick={() => {
                void setCatName(at.key, null);
                close();
              }}
              className="min-h-8 flex-1 rounded-full px-3 text-[12px] font-medium"
              style={{ border: "1px solid var(--line)" }}
            >
              원래 이름으로
            </button>
          )}
        </div>
      )}
      <span className="shrink-0 px-1 text-[12px] font-semibold">털색</span>
      <div className="grid min-h-0 grid-cols-4 gap-1 overflow-y-auto">
        {choices.map((c) => {
          const on = c.id === now.id;
          return (
            <button
              key={c.id}
              role="menuitemradio"
              aria-checked={on}
              onClick={() => choose(c.id)}
              className="flex flex-col items-center gap-0.5 rounded-xl py-1"
              style={{ border: on ? "2px solid var(--amber)" : "2px solid transparent" }}
            >
              <CatPicture coat={c} />
              <span className="text-center text-[11.5px] leading-tight font-medium break-keep">{c.word}</span>
            </button>
          );
        })}
      </div>
      {choices.length < 2 ? (
        <span className="px-1 text-[11.5px] text-ink-2">상점에서 뽑으면 더 고를 수 있어요</span>
      ) : (
        agent.role !== "lead" && !renamed && <span className="px-1 text-[11.5px] text-ink-2">별명도 털색에 맞춰 바뀌어요</span>
      )}
      <button role="menuitem" onClick={() => choose(null)} disabled={!picked} className="min-h-8 shrink-0 rounded-full px-3 text-[12px] font-medium disabled:opacity-45" style={{ border: "1px solid var(--line)" }}>
        {picked ? "자동으로 되돌리기" : "지금 자동으로 정해진 색이에요"}
      </button>
    </div>
  );
}

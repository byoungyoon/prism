// 팀원 고양이를 우클릭하면 뜨는 작은 털색 메뉴. 상점에서 가진 털색(흰색은 처음부터) 중에서 고르고,
// '자동으로 되돌리기'로 이름에 따른 자동 배정으로 돌아간다.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { isRemote } from "../lib/transport";
import { catName, coatKey, coatOf, COATS } from "./critters/pixel/coats";
import { CatPicture } from "./ShopSheet";

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
    const open = (e: MouseEvent) => {
      const key = catKeyAt(e);
      if (!key) return;
      e.preventDefault();
      setAt({ key, x: e.clientX, y: e.clientY });
    };
    window.addEventListener("contextmenu", open);
    return () => window.removeEventListener("contextmenu", open);
  }, []);
  return at ? <Menu key={`${at.key}:${at.x}:${at.y}`} at={at} close={() => setAt(null)} /> : null;
}

function Menu({ at, close }: { at: At; close: () => void }) {
  const teams = useApp((s) => s.teams);
  const projects = useApp((s) => s.projects);
  const owned = useApp((s) => s.owned);
  const picked = useApp((s) => s.coats[at.key]);
  const setCoat = useApp((s) => s.setCoat);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });

  const found = Object.values(teams)
    .flatMap((t) => t.agents.map((agent) => ({ agent, team: t })))
    .find((m) => coatKey(m.agent) === at.key);

  // 창 밖으로 나가지 않게
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = (v: number, size: number, max: number) => Math.max(8, Math.min(v, max - size - 8));
    setPos({ left: fit(at.x, el.offsetWidth, window.innerWidth), top: fit(at.y, el.offsetHeight, window.innerHeight) });
  }, [at, owned]);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    const outside = (e: Event) => !box.current?.contains(e.target as Node) && close();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
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
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("resize", close);
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
  const who = agent.role === "lead" ? `${project} 총괄` : catName(agent);
  const choose = (coat: string | null) => {
    void setCoat(at.key, coat);
    close();
  };

  return (
    <div
      ref={box}
      role="menu"
      aria-label={`${who} 털색 고르기`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="fixed z-[60] flex max-h-[min(440px,calc(100%-16px))] w-[304px] max-w-[calc(100%-16px)] flex-col gap-2 rounded-2xl p-2.5"
      style={{ ...pos, background: "var(--bg1)", color: "var(--text)", border: "1px solid var(--line)", boxShadow: "0 12px 32px rgb(0 0 0 / 0.22)" }}
    >
      <span className="truncate px-1 text-[12.5px] font-semibold">{who}의 털색</span>
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
        agent.role !== "lead" && <span className="px-1 text-[11.5px] text-ink-2">별명도 털색에 맞춰 바뀌어요</span>
      )}
      <button role="menuitem" onClick={() => choose(null)} disabled={!picked} className="min-h-8 shrink-0 rounded-full px-3 text-[12px] font-medium disabled:opacity-45" style={{ border: "1px solid var(--line)" }}>
        {picked ? "자동으로 되돌리기" : "지금 자동으로 정해진 색이에요"}
      </button>
    </div>
  );
}

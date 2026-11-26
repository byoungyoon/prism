// 상점 그림: 소품 14가지와 뽑기 상자를 48 × 48 도트로 그린다 (고양이 옆걸음과 같은 촘촘함).
// 도형 하나를 한 겹으로 칠하면서 그 색보다 짙은 테두리를 한 도트 두르고, 왼쪽 위는 밝게 ·
// 오른쪽 아래는 어둡게 마감한다. 그림은 한 번만 PNG(data: URL)로 만들어 둔다.

/** 그림 한 변의 도트 수 */
export const ART_SIZE = 48;
const N = ART_SIZE;

/** 색을 어둡게(k < 1) 또는 밝게(k > 1) */
const tone = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1));
  return `#${[n >> 16, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, "0")).join("")}`;
};

type Test = (x: number, y: number) => boolean;

class Pad {
  grid: (string | null)[][] = Array.from({ length: N }, () => Array<string | null>(N).fill(null));

  dot(x: number, y: number, c: string) {
    if (x >= 0 && y >= 0 && x < N && y < N) this.grid[y][x] = c;
  }
  /** 테두리 없이 칠하는 무늬 */
  fill(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.dot(x + i, y + j, c);
  }
  /** 도형 한 겹: 테두리 + 위·왼쪽 빛 + 아래·오른쪽 그늘 */
  layer(inside: Test, c: string) {
    const has: Test = (x, y) => x >= 0 && y >= 0 && x < N && y < N && inside(x, y);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (has(x, y)) {
          const shade = !has(x + 1, y) || !has(x, y + 2) || !has(x, y + 1);
          const light = !has(x, y - 1) || !has(x - 1, y);
          this.dot(x, y, shade ? tone(c, 0.84) : light ? tone(c, 1.3) : c);
        } else if (has(x + 1, y) || has(x - 1, y) || has(x, y + 1) || has(x, y - 1)) this.dot(x, y, tone(c, 0.48));
      }
  }
  /** 모서리를 r만큼 둥글린 네모 */
  box(x: number, y: number, w: number, h: number, c: string, r = 1) {
    this.layer((px, py) => {
      if (px < x || py < y || px >= x + w || py >= y + h) return false;
      const dx = Math.max(x + r - px, px - (x + w - 1 - r), 0);
      const dy = Math.max(y + r - py, py - (y + h - 1 - r), 0);
      return dx * dx + dy * dy <= r * r + r * 0.4;
    }, c);
  }
  oval(cx: number, cy: number, rx: number, ry: number, c: string) {
    this.layer((x, y) => ((x - cx) / (rx + 0.35)) ** 2 + ((y - cy) / (ry + 0.35)) ** 2 <= 0.96, c);
  }
  /** 꺾은선 (한 도트 굵기, 무늬용) */
  line(pts: [number, number][], c: string) {
    for (let n = 1; n < pts.length; n++) {
      const [ax, ay] = pts[n - 1];
      const [bx, by] = pts[n];
      const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
      for (let k = 0; k <= steps; k++) this.dot(Math.round(ax + ((bx - ax) * k) / steps), Math.round(ay + ((by - ay) * k) / steps), c);
    }
  }
}

const WOOD = "#b98255";
const WOOD_DK = "#96623f";
const CREAM = "#f6ead6";
const GREEN = "#6fa46a";
const BLUE = "#8fbcd9";
const PINK = "#e9a0a6";
const ROPE = "#d9bd8c";
const SOFA = "#e0925c";

/** 잎 여러 장 */
const leaves = (p: Pad, list: [number, number, number, number][]) =>
  list.forEach(([x, y, rx, ry], i) => {
    p.oval(x, y, rx, ry, i % 2 ? GREEN : "#85b872");
    p.line([[x, y - ry + 2], [x, y + ry - 2]], "#4f8250");
  });

const DRAW: Record<string, (p: Pad) => void> = {
  소파: (p) => {
    p.box(9, 38, 4, 6, WOOD_DK);
    p.box(35, 38, 4, 6, WOOD_DK);
    p.box(7, 10, 34, 22, SOFA, 7);
    p.fill(24, 13, 1, 15, tone(SOFA, 0.76));
    for (const x of [15, 33]) p.fill(x, 18, 2, 2, tone(SOFA, 0.62));
    p.box(7, 28, 34, 11, SOFA, 2);
    p.box(10, 26, 14, 6, "#eba873", 2);
    p.box(24, 26, 14, 6, "#eba873", 2);
    p.box(2, 21, 8, 19, SOFA, 3);
    p.box(38, 21, 8, 19, SOFA, 3);
    // 작은 쿠션
    p.box(11, 19, 10, 9, CREAM, 3);
    p.fill(14, 22, 4, 1, PINK);
    p.fill(15, 21, 2, 3, PINK);
  },
  책장: (p) => {
    p.box(7, 4, 34, 40, WOOD, 1);
    p.fill(10, 7, 28, 10, "#6f4a32");
    p.fill(10, 20, 28, 10, "#6f4a32");
    p.fill(10, 33, 28, 8, "#6f4a32");
    const colors = ["#c9605a", "#6d93b8", "#e0b455", "#78a06c", "#a784b4", CREAM];
    [17, 30].forEach((bottom, s) => {
      let x = 11;
      [3, 4, 3, 3, 4, 3].forEach((w, i) => {
        if (x + w > 36) return;
        const h = 7 + ((i + s) % 3);
        const c = colors[(i + s * 2) % colors.length];
        p.box(x, bottom - h, w - 1, h, c, 0);
        p.fill(x, bottom - h + 2, w - 1, 1, tone(c, 1.45));
        x += w + 1;
      });
    });
    // 아랫칸: 상자와 작은 화분
    p.box(12, 34, 12, 7, ROPE, 1);
    p.fill(16, 36, 4, 1, WOOD_DK);
    p.box(29, 37, 6, 4, "#c9755a", 1);
    leaves(p, [[30, 34, 2, 3], [34, 34, 2, 2]]);
  },
  액자: (p) => {
    p.line([[14, 11], [24, 3], [34, 11]], WOOD_DK);
    p.fill(23, 2, 3, 3, "#8d8d92");
    p.box(5, 11, 38, 31, "#d8a55c", 2);
    p.box(9, 15, 30, 23, "#bfe0ee", 0);
    p.oval(31, 21, 3.4, 3.4, "#f6cf5e");
    p.layer((x, y) => x >= 9 && x < 39 && y < 38 && y >= 25 + Math.abs(x - 18) * 0.7, "#8fb87f");
    p.layer((x, y) => x >= 9 && x < 39 && y < 38 && y >= 28 + Math.abs(x - 31) * 0.6, GREEN);
    p.fill(13, 19, 7, 2, "#ffffff");
    p.fill(15, 18, 3, 1, "#ffffff");
  },
  스탠드: (p) => {
    p.oval(24, 43, 11, 2.6, WOOD_DK);
    p.box(22, 22, 4, 21, WOOD, 0);
    p.layer((x, y) => y >= 6 && y <= 23 && Math.abs(x - 23.5) <= 9 + (y - 6) * 0.45, "#f6d987");
    for (const x of [18, 24, 30]) p.line([[x, 9], [x + Math.round((x - 24) * 0.35), 20]], "#e6bd62");
    p.box(11, 22, 26, 3, "#d9985a", 1);
    p.line([[31, 25], [31, 31]], "#8d6a45");
    p.oval(31, 33, 1.6, 1.6, "#e0b455");
    for (const [x, y] of [[6, 27], [8, 32], [41, 27], [39, 32]]) p.fill(x, y, 2, 2, "#f2c75a");
  },
  "햇살 자리": (p) => {
    p.oval(24, 38, 20, 7, "#f8e3a1");
    p.oval(24, 38, 12, 3.6, "#fdf0c4");
    p.oval(24, 17, 9, 9, "#f6c64f");
    for (const [x, y, w, h] of [[23, 2, 2, 4], [23, 28, 2, 3], [9, 16, 4, 2], [35, 16, 4, 2]]) p.box(x, y, w, h, "#f2b843", 0);
    for (const [a, b, c, d] of [[13, 6, 16, 9], [34, 6, 31, 9], [13, 27, 16, 24], [34, 27, 31, 24]]) p.line([[a, b], [c, d]], "#e5a52f");
    // 기분 좋은 얼굴
    for (const x of [19, 26]) p.line([[x, 17], [x + 1, 15], [x + 2, 17]], "#8a5a20");
    p.line([[22, 20], [23, 21], [24, 21], [25, 20]], "#8a5a20");
  },
  숨숨집: (p) => {
    p.box(7, 18, 34, 26, "#d3a56f", 1);
    p.layer((x, y) => y >= 5 && y <= 18 && Math.abs(x - 23.5) <= 3 + (y - 5) * 1.45, "#e2b983");
    p.line([[24, 7], [24, 16]], "#b98a57");
    // 둥근 문 안에서 눈이 반짝
    p.layer((x, y) => y <= 43 && (y >= 32 ? Math.abs(x - 23.5) <= 9 : (x - 23.5) ** 2 + (y - 32) ** 2 <= 84), "#4a3326");
    for (const x of [19, 26]) {
      p.fill(x, 33, 3, 3, "#e8c15a");
      p.dot(x, 33, "#fff6d8");
    }
    p.fill(35, 22, 4, 5, "#f1d9ae");
    p.line([[10, 22], [13, 22]], "#b98a57");
    p.line([[10, 25], [12, 25]], "#b98a57");
  },
  스크래처: (p) => {
    p.box(8, 39, 32, 6, WOOD, 2);
    p.box(18, 11, 12, 29, ROPE, 0);
    for (let y = 14; y < 38; y += 3) p.line([[18, y], [29, y + 1]], "#b4925f");
    for (const x of [21, 24, 27]) p.line([[x, 19], [x - 2, 27]], "#8f6f45");
    p.box(11, 5, 26, 7, "#8fae8a", 2);
    p.line([[33, 12], [36, 20]], "#7a6a5a");
    p.oval(36.5, 23, 3.4, 3.4, PINK);
  },
  털실: (p) => {
    p.line([[33, 36], [38, 41], [44, 41], [46, 38]], "#b9566a");
    p.line([[33, 37], [38, 42], [44, 42]], "#d8788a");
    p.oval(22, 25, 17, 17, "#de7f91");
    const wrap = "#b9566a";
    const hi = "#f2a9b4";
    p.line([[8, 19], [17, 15], [27, 16], [37, 23]], wrap);
    p.line([[6, 26], [16, 21], [28, 23], [37, 31]], wrap);
    p.line([[8, 33], [17, 28], [28, 31], [33, 38]], wrap);
    p.line([[14, 11], [24, 20], [27, 31], [23, 42]], wrap);
    p.line([[22, 9], [31, 18], [35, 28], [31, 38]], wrap);
    p.line([[11, 15], [19, 11], [26, 11]], hi);
    p.line([[8, 23], [15, 19], [22, 19]], hi);
    p.line([[10, 29], [16, 26], [21, 27]], hi);
  },
  밥그릇: (p) => {
    const bowl = (cx: number, c: string) => {
      p.layer((x, y) => y >= 28 && y <= 40 && Math.abs(x - cx) <= 11 - (y - 28) * 0.28, c);
      p.oval(cx, 28, 11, 3.6, tone(c, 1.35));
    };
    bowl(13, "#d9786a");
    p.oval(13, 27, 8, 2.4, "#9a6a42");
    for (const [x, y] of [[9, 25], [13, 24], [17, 26], [11, 27], [15, 27]]) p.oval(x, y, 2, 1.6, "#b9834f");
    bowl(35, "#7fa8c9");
    p.oval(35, 28, 8, 2.2, "#bfe0ee");
    p.fill(31, 27, 5, 1, "#ffffff");
    // 그릇의 물고기 무늬
    for (const cx of [13, 35]) {
      p.fill(cx - 3, 34, 5, 3, CREAM);
      p.fill(cx - 2, 33, 3, 5, CREAM);
      p.fill(cx + 3, 33, 1, 5, CREAM);
    }
  },
  러그: (p) => {
    for (let x = 5; x <= 43; x += 4) {
      p.fill(x, 9, 1, 5, "#c9a578");
      p.fill(x, 35, 1, 5, "#c9a578");
    }
    p.box(3, 13, 42, 23, "#c98d68", 2);
    p.box(7, 17, 34, 15, CREAM, 1);
    p.box(10, 20, 28, 9, "#d9a47c", 0);
    for (const cx of [16, 24, 32]) p.layer((x, y) => Math.abs(x - cx) + Math.abs(y - 24) <= 3, "#8fae8a");
  },
  "러그·쿠션": (p) => {
    p.oval(24, 34, 22, 10, "#a9b8d4");
    p.oval(24, 34, 16, 7, CREAM);
    p.oval(24, 34, 10, 4, "#c3cde2");
    p.box(11, 15, 26, 19, PINK, 7);
    p.line([[15, 19], [23, 24], [32, 19]], "#cd7d86");
    p.line([[15, 30], [23, 25], [32, 30]], "#cd7d86");
    p.oval(23.5, 24.5, 2.4, 2.2, CREAM);
  },
  화분: (p) => {
    p.line([[24, 31], [24, 18]], "#4f8250");
    leaves(p, [[14, 21, 6, 5], [34, 20, 6, 5], [17, 12, 5, 7], [31, 11, 5, 7], [24, 9, 5, 7], [19, 26, 6, 4], [30, 25, 6, 4]]);
    p.layer((x, y) => y >= 31 && y <= 44 && Math.abs(x - 23.5) <= 12 - (y - 31) * 0.3, "#c9755a");
    p.box(10, 29, 28, 5, "#d98a6c", 1);
    p.fill(15, 38, 18, 2, CREAM);
  },
  정수기: (p) => {
    p.box(13, 21, 22, 23, "#e9e6e0", 2);
    p.box(15, 3, 18, 17, BLUE, 5);
    p.fill(17, 9, 14, 1, "#c9e2f0");
    p.fill(17, 14, 14, 1, "#c9e2f0");
    p.fill(19, 5, 2, 12, "#e4f2fa");
    p.box(19, 19, 10, 3, "#7fa8c9", 0);
    p.box(17, 26, 14, 11, "#b9b6b0", 1);
    p.box(19, 26, 4, 4, "#6d93b8", 0);
    p.box(25, 26, 4, 4, "#c9605a", 0);
    p.box(22, 32, 4, 4, "#ffffff", 0);
    p.fill(18, 40, 12, 1, "#a8a49c");
  },
  캣타워: (p) => {
    p.box(6, 40, 36, 5, WOOD, 2);
    for (const [x, y, h] of [[11, 22, 18], [30, 9, 31]]) {
      p.box(x, y, 6, h, ROPE, 0);
      for (let j = y + 3; j < y + h - 1; j += 3) p.line([[x, j], [x + 5, j + 1]], "#b4925f");
    }
    p.box(14, 27, 20, 13, "#c9a06f", 2);
    p.oval(24, 34, 4.4, 4.4, "#4a3326");
    p.box(5, 19, 20, 5, "#8fae8a", 2);
    p.box(22, 7, 23, 5, "#8fae8a", 2);
    p.oval(34, 6, 8, 3, CREAM);
    p.line([[40, 12], [40, 20]], "#7a6a5a");
    p.oval(40.5, 22, 2.8, 2.8, PINK);
  },
  /** 고양이 뽑기 상자 */
  "뽑기 상자": (p) => {
    p.box(9, 21, 30, 23, "#d3a56f", 1);
    p.box(6, 14, 36, 8, "#e2b983", 1);
    p.box(21, 14, 6, 30, "#d9786a", 0);
    // 리본
    p.oval(17, 10, 6, 4, "#e58c7e");
    p.oval(31, 10, 6, 4, "#e58c7e");
    p.box(21, 9, 6, 6, "#d9786a", 2);
    // 물음표
    p.line([[12, 29], [13, 28], [16, 28], [17, 29], [17, 31], [15, 33], [15, 35]], "#7a5232");
    p.fill(15, 38, 1, 2, "#7a5232");
    // 고양이 발자국
    p.oval(33, 35, 3, 2.6, "#8f6440");
    for (const [x, y] of [[29, 31], [33, 29], [37, 31]]) p.fill(x, y, 2, 2, "#8f6440");
  },
};

/** 그림이 있는 이름 */
export const ART_NAMES = Object.keys(DRAW);

const cache = new Map<string, string>();

/** 이름의 그림을 PNG data: URL로 (한 번만 그린다). 모르는 이름이면 빈 문자열 */
export function shopArt(name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const draw = DRAW[name];
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const g = c.getContext("2d");
  if (!draw || !g) return "";
  const pad = new Pad();
  draw(pad);
  pad.grid.forEach((row, y) =>
    row.forEach((color, x) => {
      if (!color) return;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }),
  );
  const url = c.toDataURL("image/png");
  cache.set(name, url);
  return url;
}

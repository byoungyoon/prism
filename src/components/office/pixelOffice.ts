// The office in dots, drawn like the cats (critters/pixel): every piece of furniture is a small
// picture made here, dot by dot, with a dark outline and a soft shadow down and to the right, in
// soft pastel colours — one set for the light theme, one for the dark. Each picture becomes a PNG
// (data: URL) once, and goes into one <style>: `--pxi-<name>` holds the picture per theme, and
// `.px-<name>` sizes an element to the picture in whole dots (`--u` screen pixels per dot, the
// same as a cat's dot), so nothing is ever smudged (image-rendering: pixelated).

type Pal = Record<string, string>;

/** a drawing surface in dots; colours are palette keys */
class Dots {
  grid: (string | null)[][];
  constructor(
    public w: number,
    public h: number,
  ) {
    this.grid = Array.from({ length: h }, () => Array<string | null>(w).fill(null));
  }
  px(x: number, y: number, c: string | null) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.grid[y][x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: string | null) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }
  /** a rectangle with its four corner dots cut (a softer, rounder box) */
  box(x: number, y: number, w: number, h: number, c: string) {
    this.rect(x, y, w, h, c);
    for (const [i, j] of [
      [x, y],
      [x + w - 1, y],
      [x, y + h - 1],
      [x + w - 1, y + h - 1],
    ])
      this.px(i, j, null);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, c);
      }
  }
  /** dots from rows of letters ('.' = empty), each letter a palette key from `keys` */
  art(x: number, y: number, rows: string[], keys: Record<string, string>) {
    rows.forEach((r, j) => [...r].forEach((ch, i) => ch !== "." && this.px(x + i, y + j, keys[ch])));
  }
}

interface Sprite {
  w: number;
  h: number;
  draw: (d: Dots) => void;
  /** outline and drop shadow (furniture); tiles have neither */
  solid?: boolean;
}

// ── the pictures ──────────────────────────────────────────

const desk = (w: number, lead: boolean): Sprite => ({
  w,
  h: 9,
  solid: true,
  draw: (d) => {
    const [top, hi, dk, dk2] = lead ? ["lwood", "lwoodHi", "lwoodDk", "lwoodDk2"] : ["wood", "woodHi", "woodDk", "woodDk2"];
    // the top: a light edge, then the surface
    d.rect(0, 0, w, 1, hi);
    d.rect(0, 1, w, 2, top);
    // the front: a panel with drawers on each side
    d.rect(0, 3, w, 6, dk);
    d.rect(0, 3, w, 1, dk2);
    const dw = lead ? 12 : 9;
    for (const x0 of [2, w - 2 - dw]) {
      d.rect(x0, 4, dw, 4, top);
      d.rect(x0, 6, dw, 1, dk);
      d.px(x0 + Math.floor(dw / 2), 5, "line");
      d.px(x0 + Math.floor(dw / 2), 7, "line");
    }
    if (lead) {
      // a gold trim along the front of the 총괄's desk
      d.rect(1, 3, w - 2, 1, "gold");
    }
  },
});

const chair = (lead: boolean): Sprite => ({
  w: lead ? 18 : 16,
  h: 13,
  solid: true,
  draw: (d) => {
    const w = lead ? 18 : 16;
    const [c, hi, dk] = lead ? ["lchair", "lchairHi", "lchairDk"] : ["chair", "chairHi", "chairDk"];
    d.box(0, 0, w, 12, c);
    d.rect(1, 1, w - 2, 1, hi);
    d.rect(2, 2, 2, 7, hi);
    d.rect(0, 10, w, 2, dk);
    d.px(0, 10, null);
    d.px(w - 1, 10, null);
    // a stitched seam down the back
    for (let y = 3; y < 9; y += 2) d.px(Math.floor(w / 2), y, dk);
    d.rect(Math.floor(w / 2) - 1, 12, 2, 1, "metalDk");
  },
});

const monitor: Sprite = {
  w: 12,
  h: 11,
  solid: true,
  draw: (d) => {
    d.box(0, 0, 12, 8, "metal");
    d.rect(1, 1, 10, 6, "screen");
    d.rect(1, 1, 10, 1, "screenHi");
    // a few lines of code on the screen
    d.rect(2, 3, 4, 1, "code1");
    d.rect(7, 3, 2, 1, "code2");
    d.rect(3, 5, 5, 1, "code1");
    d.rect(5, 8, 2, 2, "metalDk");
    d.rect(3, 10, 6, 1, "metalDk");
  },
};

const keyboard: Sprite = {
  w: 11,
  h: 2,
  solid: true,
  draw: (d) => {
    d.rect(0, 0, 11, 2, "paper");
    for (let x = 1; x < 10; x += 2) d.px(x, 0, "paperDk");
  },
};

const mug: Sprite = {
  w: 5,
  h: 4,
  solid: true,
  draw: (d) => {
    d.rect(0, 0, 4, 4, "mug");
    d.rect(0, 0, 4, 1, "coffee");
    d.px(4, 1, "mug");
    d.px(4, 2, "mug");
  },
};

const headset: Sprite = {
  w: 7,
  h: 5,
  solid: true,
  draw: (d) =>
    d.art(0, 0, [".mmmmm.", "m.....m", "m.....m", "pp...pp", "pp...pp"], { m: "metalDk", p: "pink" }),
};

const papers: Sprite = {
  w: 9,
  h: 5,
  solid: true,
  draw: (d) => {
    d.rect(1, 0, 8, 2, "paperDk");
    d.rect(0, 2, 8, 3, "paper");
    d.rect(1, 3, 5, 1, "paperDk");
  },
};

const toolbox: Sprite = {
  w: 8,
  h: 6,
  solid: true,
  draw: (d) => {
    d.art(2, 0, ["mmmm", "m..m"], { m: "metalDk" });
    d.rect(0, 2, 8, 4, "red");
    d.rect(0, 3, 8, 1, "redDk");
    d.px(4, 4, "gold");
  },
};

const windowArt: Sprite = {
  w: 30,
  h: 13,
  solid: true,
  draw: (d) => {
    d.rect(0, 0, 30, 13, "woodDk");
    d.rect(1, 1, 28, 11, "sky");
    d.rect(1, 1, 28, 3, "skyHi");
    // clouds by day, a moon and stars by night (the same keys: `cloud` is the moon at night)
    d.art(4, 4, [".cc..", "ccccc"], { c: "cloud" });
    d.art(18, 6, ["..cc.", ".cccc", "cccccc"], { c: "cloud" });
    d.px(11, 2, "star");
    d.px(25, 3, "star");
    d.px(8, 9, "star");
    // the middle bar and the sill
    d.rect(14, 1, 2, 11, "woodDk");
    d.rect(0, 12, 30, 1, "wood");
    // curtains tied at the sides
    d.rect(1, 1, 3, 9, "curtain");
    d.rect(26, 1, 3, 9, "curtain");
    d.px(3, 1, "curtainDk");
    d.px(26, 1, "curtainDk");
    d.rect(1, 6, 3, 1, "curtainDk");
    d.rect(26, 6, 3, 1, "curtainDk");
  },
};

const clock: Sprite = {
  w: 11,
  h: 11,
  solid: true,
  draw: (d) => {
    d.ellipse(5.5, 5.5, 5.5, 5.5, "clockRim");
    d.ellipse(5.5, 5.5, 4.3, 4.3, "clockFace");
    for (const [x, y] of [
      [5, 2],
      [8, 5],
      [5, 8],
      [2, 5],
    ])
      d.px(x, y, "paperDk");
    // ten past two, more or less
    d.rect(5, 3, 1, 3, "line");
    d.rect(5, 5, 3, 1, "line");
    d.px(5, 5, "red");
  },
};

const shelf: Sprite = {
  w: 26,
  h: 12,
  solid: true,
  draw: (d) => {
    // books of all heights, a little plant at the end
    const books: [number, number, string][] = [
      [1, 9, "book1"],
      [3, 8, "book2"],
      [5, 9, "book3"],
      [7, 7, "book4"],
      [9, 9, "book5"],
      [11, 8, "book1"],
    ];
    for (const [x, h, c] of books) {
      d.rect(x, 10 - h, 2, h, c);
      d.px(x, 10 - h + 2, "paper");
    }
    // one leaning over
    d.art(13, 3, ["...bb", "..bb.", ".bb..", "bb...", "b...."], { b: "book3" });
    d.rect(13, 8, 1, 2, "book3");
    d.rect(20, 7, 4, 3, "pot");
    d.art(19, 3, [".l.l..", "lllll.", ".llll."], { l: "leaf" });
    d.rect(0, 10, 26, 2, "woodDk");
    d.rect(0, 10, 26, 1, "wood");
  },
};

const door: Sprite = {
  w: 12,
  h: 18,
  solid: true,
  draw: (d) => {
    d.rect(0, 0, 12, 18, "woodDk2");
    d.rect(1, 1, 10, 17, "door");
    d.rect(2, 2, 8, 6, "doorDk");
    d.rect(3, 3, 6, 4, "door");
    d.rect(2, 10, 8, 6, "doorDk");
    d.rect(3, 11, 6, 4, "door");
    d.px(9, 9, "gold");
    d.px(9, 10, "gold");
  },
};

const sofa: Sprite = {
  w: 42,
  h: 15,
  solid: true,
  draw: (d) => {
    // the back
    d.box(3, 0, 36, 8, "sofa");
    d.rect(4, 1, 34, 1, "sofaHi");
    // two seat cushions
    d.box(3, 7, 18, 5, "sofaHi");
    d.box(21, 7, 18, 5, "sofaHi");
    d.rect(3, 11, 36, 1, "sofaDk");
    // the arms
    d.box(0, 4, 4, 9, "sofaDk");
    d.box(38, 4, 4, 9, "sofaDk");
    d.rect(1, 4, 2, 1, "sofa");
    d.rect(39, 4, 2, 1, "sofa");
    d.rect(3, 12, 36, 1, "sofaDk");
    // legs
    d.rect(2, 13, 2, 2, "woodDk2");
    d.rect(38, 13, 2, 2, "woodDk2");
    // throw cushions
    d.box(5, 3, 7, 6, "mint");
    d.px(8, 5, "mintDk");
    d.box(30, 3, 7, 6, "pink");
    d.px(33, 5, "pinkDk");
  },
};

const cushion: Sprite = {
  w: 13,
  h: 6,
  solid: true,
  draw: (d) => {
    d.ellipse(6.5, 3, 6.5, 3, "lav");
    d.rect(2, 1, 9, 1, "lavHi");
    d.px(6, 3, "lavDk");
    d.px(0, 3, "lavDk");
    d.px(12, 3, "lavDk");
  },
};

const coffee: Sprite = {
  w: 11,
  h: 16,
  solid: true,
  draw: (d) => {
    d.box(0, 0, 11, 16, "machine");
    d.rect(1, 1, 9, 3, "machineDk");
    d.px(8, 2, "lamp");
    d.rect(2, 2, 4, 1, "screenHi");
    // the nozzle and a cup under it
    d.rect(3, 5, 5, 7, "machineDk");
    d.rect(5, 5, 1, 2, "metal");
    d.rect(4, 9, 3, 3, "mug");
    d.px(4, 9, "coffee");
    d.px(5, 9, "coffee");
    d.px(6, 9, "coffee");
    d.rect(1, 13, 9, 2, "machineDk");
  },
};

const plant: Sprite = {
  w: 11,
  h: 16,
  solid: true,
  draw: (d) => {
    d.art(0, 0, ["....l.l....", "..lllhlll..", ".llhlllldl.", "lldlllhllll", ".lllldllll.", "llhllllldll", ".llldlll...", "...lllll..."], { l: "leaf", h: "leafHi", d: "leafDk" });
    d.rect(5, 7, 1, 2, "leafDk");
    d.rect(1, 9, 9, 2, "potDk");
    d.rect(2, 11, 7, 5, "pot");
    d.rect(2, 11, 7, 1, "potDk");
  },
};

const tower: Sprite = {
  w: 16,
  h: 27,
  solid: true,
  draw: (d) => {
    // the top platform
    d.box(0, 0, 11, 3, "carpet");
    d.rect(1, 2, 9, 1, "carpetDk");
    // a rope post
    d.rect(4, 3, 3, 7, "rope");
    for (let y = 4; y < 10; y += 2) d.rect(4, y, 3, 1, "ropeDk");
    // a little house with a round hole
    d.box(3, 10, 13, 9, "carpet");
    d.rect(3, 17, 13, 2, "carpetDk");
    d.ellipse(9.5, 14.5, 2.6, 2.6, "line");
    // a toy on a string
    d.rect(1, 3, 1, 4, "line");
    d.box(0, 7, 3, 3, "pink");
    // the lower post and the base
    d.rect(7, 19, 3, 5, "rope");
    d.rect(7, 20, 3, 1, "ropeDk");
    d.rect(7, 22, 3, 1, "ropeDk");
    d.box(1, 24, 15, 3, "carpet");
    d.rect(1, 26, 15, 1, "carpetDk");
  },
};

const rug: Sprite = {
  w: 54,
  h: 16,
  solid: true,
  draw: (d) => {
    d.ellipse(27, 8, 27, 8, "rugTrim");
    d.ellipse(27, 8, 25, 6.6, "rug");
    d.ellipse(27, 8, 18, 4.2, "rugDk");
    d.ellipse(27, 8, 16, 3.2, "rug");
    // a row of little diamonds
    for (const x of [14, 20, 27, 34, 40]) {
      d.px(x, 8, "rugTrim");
      d.px(x - 1, 8, "rugDk");
      d.px(x + 1, 8, "rugDk");
    }
  },
};

/** the floor: wooden planks, two per tile, their joints staggered */
const floor: Sprite = {
  w: 24,
  h: 8,
  draw: (d) => {
    d.rect(0, 0, 24, 8, "plank");
    d.rect(0, 3, 24, 1, "plankSeam");
    d.rect(0, 7, 24, 1, "plankSeam");
    d.rect(9, 0, 1, 3, "plankSeam");
    d.rect(21, 4, 1, 3, "plankSeam");
    d.rect(3, 1, 3, 1, "plankDk");
    d.rect(14, 5, 4, 1, "plankDk");
  },
};

/** the wall: soft stripes with a dot pattern */
const wall: Sprite = {
  w: 8,
  h: 8,
  draw: (d) => {
    d.rect(0, 0, 8, 8, "wall");
    d.rect(0, 0, 1, 8, "wallStripe");
    d.rect(4, 0, 1, 8, "wallStripe");
    d.px(2, 2, "wallDot");
    d.px(6, 6, "wallDot");
  },
};

/** a sunny patch of floor under the window (no outline: light on the tiles) */
const sunspot: Sprite = {
  w: 30,
  h: 12,
  draw: (d) => {
    d.ellipse(15, 6, 15, 6, "sunEdge");
    d.ellipse(15, 6, 12.5, 4.6, "sun");
    d.rect(14, 0, 2, 12, "sunEdge");
    d.rect(9, 3, 12, 1, "sun");
  },
};

/** a cardboard hideout with a round door */
const catbox: Sprite = {
  w: 22,
  h: 14,
  solid: true,
  draw: (d) => {
    d.rect(0, 0, 22, 14, "cardboard");
    d.rect(0, 0, 22, 2, "cardboardHi");
    d.rect(0, 12, 22, 2, "cardboardDk");
    d.rect(9, 0, 4, 2, "tape");
    d.ellipse(11, 9, 4.2, 4.2, "line");
    d.rect(7, 10, 8, 4, "line");
    d.px(2, 6, "cardboardDk");
    d.px(19, 5, "cardboardDk");
  },
};

const scratcher: Sprite = {
  w: 20,
  h: 8,
  solid: true,
  draw: (d) => {
    d.box(0, 0, 20, 8, "cardboard");
    d.rect(0, 6, 20, 2, "cardboardDk");
    for (let x = 2; x < 18; x += 2) d.rect(x, 1, 1, 4, "cardboardDk");
    d.rect(1, 0, 18, 1, "cardboardHi");
  },
};

const yarn: Sprite = {
  w: 7,
  h: 7,
  solid: true,
  draw: (d) => {
    d.ellipse(3.5, 3.5, 3.5, 3.5, "yarn");
    d.px(2, 2, "yarnHi");
    d.rect(1, 4, 5, 1, "yarnDk");
    d.rect(3, 1, 1, 5, "yarnDk");
  },
};

const bowls: Sprite = {
  w: 22,
  h: 6,
  solid: true,
  draw: (d) => {
    d.rect(0, 0, 22, 6, "mat");
    d.box(1, 1, 9, 4, "bowl");
    d.rect(2, 2, 7, 1, "kibble");
    d.box(12, 1, 9, 4, "bowl");
    d.rect(13, 2, 7, 1, "water");
  },
};

const bookcase: Sprite = {
  w: 16,
  h: 24,
  solid: true,
  draw: (d) => {
    d.rect(0, 0, 16, 24, "wood");
    d.rect(1, 1, 14, 6, "woodDk");
    d.rect(1, 9, 14, 6, "woodDk");
    d.rect(1, 17, 14, 6, "woodDk");
    const row = (y: number, ks: string[]) => ks.forEach((k, i) => d.rect(2 + i * 3, y + (i % 2), 2, 5 - (i % 2), k));
    row(1, ["book1", "book3", "book4", "book2"]);
    row(9, ["book5", "book2", "book1", "book3"]);
    d.rect(2, 21, 5, 2, "book4");
    d.rect(9, 19, 4, 4, "pot");
  },
};

const frame: Sprite = {
  w: 12,
  h: 10,
  solid: true,
  draw: (d) => {
    d.rect(0, 0, 12, 10, "wood");
    d.rect(1, 1, 10, 8, "sky");
    d.ellipse(6, 7.5, 4, 3, "leaf");
    d.ellipse(8, 3.5, 1.4, 1.4, "gold");
  },
};

const lamp: Sprite = {
  w: 10,
  h: 22,
  solid: true,
  draw: (d) => {
    d.art(0, 0, ["..llllll..", ".llllllll.", "llllllllll"], { l: "shade" });
    d.rect(4, 3, 2, 15, "metal");
    d.rect(1, 18, 8, 4, "metalDk");
    d.rect(1, 18, 8, 1, "metal");
  },
};

const rug2: Sprite = {
  w: 30,
  h: 12,
  solid: true,
  draw: (d) => {
    d.rect(0, 0, 30, 12, "rugTrim");
    d.rect(1, 1, 28, 10, "carpet");
    for (let x = 3; x < 27; x += 4) {
      d.rect(x, 3, 2, 2, "carpetDk");
      d.rect(x + 2, 7, 2, 2, "carpetDk");
    }
  },
};

/** the lounge floor: soft checker tiles */
const tiles: Sprite = {
  w: 8,
  h: 8,
  draw: (d) => {
    d.rect(0, 0, 8, 8, "tileA");
    d.rect(0, 0, 4, 4, "tileB");
    d.rect(4, 4, 4, 4, "tileB");
  },
};

export const SPRITES: Record<string, Sprite> = {
  desk: desk(42, false),
  "desk-lead": desk(56, true),
  chair: chair(false),
  "chair-lead": chair(true),
  monitor,
  keyboard,
  mug,
  headset,
  papers,
  toolbox,
  window: windowArt,
  clock,
  shelf,
  door,
  sofa,
  cushion,
  coffee,
  plant,
  tower,
  rug,
  sunspot,
  catbox,
  scratcher,
  yarn,
  bowls,
  bookcase,
  frame,
  lamp,
  rug2,
  floor,
  wall,
  tiles,
};

// ── colours ───────────────────────────────────────────────

const LIGHT: Pal = {
  line: "#5b4636",
  shadow: "rgba(91, 64, 42, 0.2)",
  wood: "#ebc79f",
  woodHi: "#f6dcbd",
  woodDk: "#d4a77c",
  woodDk2: "#bd8f66",
  lwood: "#e3b39a",
  lwoodHi: "#f2cdb8",
  lwoodDk: "#c99178",
  lwoodDk2: "#b27b63",
  gold: "#f3cf73",
  chair: "#aebbe0",
  chairHi: "#c9d3ef",
  chairDk: "#909fc8",
  lchair: "#e7a1a1",
  lchairHi: "#f2c0bd",
  lchairDk: "#cc8285",
  metal: "#7a83a3",
  metalDk: "#5f6787",
  screen: "#bfe9de",
  screenHi: "#e6f8f2",
  code1: "#7cc4b2",
  code2: "#f2a9b6",
  paper: "#fffaf1",
  paperDk: "#e9dac6",
  mug: "#fff4ea",
  coffee: "#b07a57",
  red: "#f0a199",
  redDk: "#d9837c",
  pink: "#f6c4cd",
  pinkDk: "#e3a1ae",
  mint: "#bfe5d1",
  mintDk: "#97cdb2",
  lav: "#cdd3f3",
  lavHi: "#e2e6fa",
  lavDk: "#a9b1df",
  sky: "#cfe7f6",
  skyHi: "#e7f4fb",
  cloud: "#ffffff",
  star: "#cfe7f6",
  curtain: "#f6c8d0",
  curtainDk: "#e5a8b5",
  clockRim: "#f0b9a3",
  clockFace: "#fffaf2",
  book1: "#f2a7a0",
  book2: "#a8d8bc",
  book3: "#aabfea",
  book4: "#f5d48c",
  book5: "#d5b8e8",
  door: "#e2bb94",
  doorDk: "#cfa27a",
  sofa: "#f6b993",
  sofaHi: "#fbd0b2",
  sofaDk: "#e39d77",
  machine: "#9aa3c2",
  machineDk: "#7a83a3",
  lamp: "#ff8f80",
  pot: "#eaa682",
  potDk: "#cf8a68",
  leaf: "#a3d7a9",
  leafHi: "#c8ecc8",
  leafDk: "#7dbb88",
  carpet: "#cdbdea",
  carpetDk: "#b0a0d6",
  rope: "#e2c59c",
  ropeDk: "#c9a776",
  rug: "#cfe1f3",
  rugDk: "#b6cce7",
  rugTrim: "#f6d8a9",
  plank: "#f1e0c8",
  plankDk: "#ecdbc1",
  plankSeam: "#ead6ba",
  wall: "#f7ecde",
  wallStripe: "#f1e3d0",
  wallDot: "#ead8c0",
  tileA: "#f4ead9",
  tileB: "#eee1cd",
  sun: "#fbeab8",
  sunEdge: "#f7e1a3",
  cardboard: "#e2b988",
  cardboardHi: "#efcfa5",
  cardboardDk: "#c99d6c",
  tape: "#f3e3c3",
  yarn: "#f19fb0",
  yarnHi: "#f8c3cd",
  yarnDk: "#d9808f",
  mat: "#cfe1f3",
  bowl: "#fff4ea",
  kibble: "#c98e5e",
  water: "#a9d6ee",
  shade: "#fbe3a6",
};

const DARK: Pal = {
  ...LIGHT,
  line: "#18120e",
  shadow: "rgba(0, 0, 0, 0.32)",
  wood: "#9c7655",
  woodHi: "#b18b68",
  woodDk: "#7f5d41",
  woodDk2: "#694b33",
  lwood: "#94634f",
  lwoodHi: "#a97864",
  lwoodDk: "#7a4f3e",
  lwoodDk2: "#653f31",
  gold: "#c9a755",
  chair: "#5e6a8f",
  chairHi: "#75819f",
  chairDk: "#4b5677",
  lchair: "#9a5f62",
  lchairHi: "#b27477",
  lchairDk: "#804c50",
  metal: "#4a5068",
  metalDk: "#363b4f",
  screen: "#5aa596",
  screenHi: "#7cc0b1",
  code1: "#2f6f63",
  code2: "#c98794",
  paper: "#d9cfc0",
  paperDk: "#b5a893",
  mug: "#d9cfc0",
  coffee: "#7a523a",
  red: "#bd7068",
  redDk: "#9d5953",
  pink: "#c08f98",
  pinkDk: "#a3737d",
  mint: "#7fae98",
  mintDk: "#64917c",
  lav: "#7c84ad",
  lavHi: "#9097bd",
  lavDk: "#646b93",
  sky: "#27365a",
  skyHi: "#30416a",
  cloud: "#f1e2ad",
  star: "#f6e7b3",
  curtain: "#a87c88",
  curtainDk: "#8d6470",
  clockRim: "#a8705c",
  clockFace: "#e6dccb",
  book1: "#b66f69",
  book2: "#6f9b82",
  book3: "#6e82ad",
  book4: "#b89c5c",
  book5: "#957aa8",
  door: "#8a6a4d",
  doorDk: "#735538",
  sofa: "#b47d5c",
  sofaHi: "#c99273",
  sofaDk: "#97654a",
  machine: "#5a6284",
  machineDk: "#454c69",
  lamp: "#ff7a6a",
  pot: "#a86f55",
  potDk: "#8c5a44",
  leaf: "#6b9e72",
  leafHi: "#86b88a",
  leafDk: "#52845b",
  carpet: "#8678ad",
  carpetDk: "#6d6096",
  rope: "#a68b66",
  ropeDk: "#89704f",
  rug: "#3e5470",
  rugDk: "#34475f",
  rugTrim: "#a88c5e",
  plank: "#33291f",
  plankDk: "#30271e",
  plankSeam: "#2d241b",
  wall: "#2f2720",
  wallStripe: "#2b241d",
  wallDot: "#3a3027",
  tileA: "#2f271f",
  tileB: "#2a231c",
  sun: "#4a3f27",
  sunEdge: "#41372a",
  cardboard: "#9a7650",
  cardboardHi: "#b08a62",
  cardboardDk: "#7f5f3f",
  tape: "#b9a27c",
  yarn: "#b9707f",
  yarnHi: "#d08c99",
  yarnDk: "#9a5764",
  mat: "#3e5470",
  bowl: "#d9cfc0",
  kibble: "#8f6540",
  water: "#6a95b3",
  shade: "#d9b868",
};

// ── drawing ───────────────────────────────────────────────

/** how big a sprite is once drawn: one dot of outline all round, one more right and below for the shadow */
export const outer = (s: Sprite) => (s.solid ? { w: s.w + 3, h: s.h + 3 } : { w: s.w, h: s.h });

function toUrl(s: Sprite, pal: Pal): string {
  const d = new Dots(s.w, s.h);
  s.draw(d);
  const { w, h } = outer(s);
  const off = s.solid ? 1 : 0;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return "";
  const filled = (x: number, y: number) => {
    const gx = x - off;
    const gy = y - off;
    return gx >= 0 && gy >= 0 && gx < s.w && gy < s.h && d.grid[gy][gx] != null;
  };
  if (s.solid) {
    const edge = (x: number, y: number) => !filled(x, y) && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1));
    // the shadow: where the outlined shape, moved one dot down-right, lands on nothing
    const inked = (x: number, y: number) => filled(x, y) || edge(x, y);
    g.fillStyle = pal.shadow;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!inked(x, y) && inked(x - 1, y - 1)) g.fillRect(x, y, 1, 1);
    g.fillStyle = pal.line;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (edge(x, y)) g.fillRect(x, y, 1, 1);
  }
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const k = d.grid[y][x];
      if (k == null) continue;
      g.fillStyle = pal[k] ?? "#ff00ff";
      g.fillRect(x + off, y + off, 1, 1);
    }
  return c.toDataURL("image/png");
}

/**
 * Puts the pictures into the page once: `--pxi-<name>` per theme (.t-light / .t-dark), and
 * `.px-<name>` sized to its picture in dots of `--u` px. Safe to call on every render.
 */
export function ensurePixelOffice() {
  if (typeof document === "undefined" || document.getElementById("of-pixel-art")) return;
  const vars = (pal: Pal) =>
    Object.entries(SPRITES)
      .map(([n, s]) => `--pxi-${n}: url(${toUrl(s, pal)});`)
      .join("\n  ");
  const sizes = Object.entries(SPRITES)
    .map(([n, s]) => {
      const { w, h } = outer(s);
      return `.of-room .px-${n} { width: calc(var(--u) * ${w}); height: calc(var(--u) * ${h}); background: var(--pxi-${n}) 0 0 / 100% 100% no-repeat; image-rendering: pixelated; }`;
    })
    .join("\n");
  const css = `.t-light, :root {\n  ${vars(LIGHT)}\n}\n.t-dark {\n  ${vars(DARK)}\n}\n${sizes}\n`;
  const el = document.createElement("style");
  el.id = "of-pixel-art";
  el.textContent = css;
  document.head.appendChild(el);
}

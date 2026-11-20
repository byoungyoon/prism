// Claude model catalog for pickers. Prices: USD per 1M tokens (input / output), Claude API list price.
import type { Effort } from "../lib/api";

export interface ModelVersion {
  /** passed to `claude --model` */
  id: string;
  label: string;
  price: [number, number];
}

export interface ModelFamily {
  family: "fable" | "opus" | "sonnet" | "haiku";
  label: string;
  note: string;
  versions: ModelVersion[];
}

export const FAMILIES: ModelFamily[] = [
  {
    family: "fable",
    label: "Fable",
    note: "가장 강력 · 가장 비쌈",
    versions: [
      { id: "fable", label: "최신", price: [8, 40] },
      { id: "claude-fable-5-2", label: "5.2", price: [8, 40] },
    ],
  },
  {
    family: "opus",
    label: "Opus",
    note: "판단과 설계에 강함",
    versions: [
      { id: "opus", label: "최신", price: [4, 20] },
      { id: "claude-opus-5-5", label: "5.5", price: [4, 20] },
      { id: "claude-opus-5", label: "5", price: [5, 25] },
      { id: "claude-opus-4-8", label: "4.8", price: [5, 25] },
    ],
  },
  {
    family: "sonnet",
    label: "Sonnet",
    note: "빠르고 균형 잡힘",
    versions: [
      { id: "sonnet", label: "최신", price: [2, 10] },
      { id: "claude-sonnet-5-5", label: "5.5", price: [2, 10] },
      { id: "claude-sonnet-5", label: "5", price: [2, 10] },
    ],
  },
  {
    family: "haiku",
    label: "Haiku",
    note: "가장 싸고 빠름",
    versions: [
      { id: "haiku", label: "최신", price: [0.1, 0.5] },
      { id: "claude-haiku-5-5", label: "5.5", price: [0.1, 0.5] },
      { id: "claude-haiku-4-5", label: "4.5", price: [1, 5] },
    ],
  },
];

export const ALL_MODEL_IDS = FAMILIES.flatMap((f) => f.versions.map((v) => v.id));

export function findModel(id: string): { family: ModelFamily; version: ModelVersion } | undefined {
  for (const family of FAMILIES) {
    const version = family.versions.find((v) => v.id === id);
    if (version) return { family, version };
  }
  // unknown id: guess the family from its name
  const family = FAMILIES.find((f) => id.includes(f.family));
  return family ? { family, version: { id, label: id, price: family.versions[0].price } } : undefined;
}

/** "opus" → "opus", "claude-opus-5-5" → "opus 5.5" */
export function modelLabel(id: string) {
  const m = findModel(id);
  if (!m) return id;
  return m.version.label === "최신" ? m.family.family : `${m.family.family} ${m.version.label}`;
}

export const EFFORTS: { id: Exclude<Effort, "">; label: string }[] = [
  { id: "low", label: "낮음" },
  { id: "medium", label: "보통" },
  { id: "high", label: "높음" },
  { id: "xhigh", label: "매우 높음" },
  { id: "max", label: "최대" },
];

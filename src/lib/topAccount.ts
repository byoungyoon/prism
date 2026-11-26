import type { Account, Provider } from "./api";

export const PROVIDER_NAME: Record<Provider, string> = { claude: "Claude", codex: "ChatGPT", antigravity: "Gemini" };

const ORDER: Provider[] = ["claude", "codex", "antigravity"];

/** The account the top bar stands for. Each service has its own "active" account, so take a
 *  signed-in one (Claude first) — a ChatGPT-only user must not see Claude's signed-out one. */
export function topAccount(accounts: Account[]): Account | undefined {
  const actives = accounts.filter((a) => a.active).sort((x, y) => ORDER.indexOf(x.provider) - ORDER.indexOf(y.provider));
  return actives.find((a) => a.status.loggedIn) ?? actives[0];
}

/** "기본" says nothing about whose account it is, so show the service name instead. */
export function topAccountName(a: Account): string {
  return a.name === "기본" ? PROVIDER_NAME[a.provider] : a.name;
}

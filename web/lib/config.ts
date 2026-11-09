// Public, non-secret settings. They come from the root .env (NEXT_PUBLIC_ prefix only).
export const NETWORK = process.env.NEXT_PUBLIC_NETWORK ?? "testnet";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.testnet.near.org";
export const FACTORY_ID = process.env.NEXT_PUBLIC_FACTORY_ID ?? "factory.ejecto.testnet";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** Public URL of the deployed site, used for absolute social image links. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const EXPLORER_URL =
  NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

export const REPO_URL = "https://github.com/wngstnr-code/ejecto";

export function explorerAccount(accountId: string) {
  return `${EXPLORER_URL}/address/${accountId}`;
}

/** Prefix a path in /public with the base path (needed on GitHub Pages). */
export function asset(path: string) {
  return `${BASE_PATH}${path}`;
}

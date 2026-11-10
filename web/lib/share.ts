import { formatNear } from "./format";

/**
 * A post intent on X: opens the composer with the text filled in. No API, no keys, nothing is sent
 * until the user presses Post on X.
 */
export function xIntent(text: string, url: string) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/** Link to a coin page on the site the user is on (works on the live site and on a local build). */
export function coinLink(coinId: string) {
  const origin = typeof window === "undefined" ? "https://ejecto.vercel.app" : window.location.origin;
  return `${origin}/coin/?id=${coinId}`;
}

const TAG = "Every memecoin needs an ejecto seato.";

/** After a claim: what the parachute paid. */
export function parachuteText(symbol: string, near: number | null) {
  const s = `$${symbol.toUpperCase()}`;
  // Amounts under 0.01 NEAR would read "<0.01", so those get the plain version.
  return near !== null && near >= 0.01
    ? `My ${s} parachute opened: ${formatNear(near, 4)} NEAR back after the coin died. No exit race, every holder claimed a fair share. ${TAG}`
    : `I landed safely from ${s}. When it died, nobody raced for the exit: every holder claimed a fair share. ${TAG}`;
}

/** A seat on a coin that is still trading: what it would pay if the coin died now. */
export function seatText(symbol: string, near: number) {
  return `My $${symbol.toUpperCase()} seat would pay ${formatNear(near, 4)} NEAR if the coin died today. On Ejecto, a dead coin ends with a fair split, not an exit race. ${TAG}`;
}

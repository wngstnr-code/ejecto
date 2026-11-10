import { EXPLORER_URL } from "@/lib/config";

export type Tx = { state: "pending" | "done" | "error"; text: string; hash?: string | null };

/** One line under an action button: waiting, done (with an explorer link) or the error. */
export function TxNote({ tx }: { tx: Tx | null }) {
  if (!tx) return null;
  const tone = tx.state === "error" ? "text-eject" : tx.state === "done" ? "text-hud" : "text-muted";
  return (
    <p className={`label mt-4 leading-relaxed ${tone}`} role="status">
      {tx.text}
      {tx.hash && (
        <>
          {" "}
          <a href={`${EXPLORER_URL}/txns/${tx.hash}`} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-bone">
            View transaction
          </a>
        </>
      )}
    </p>
  );
}

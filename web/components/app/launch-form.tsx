"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GAS } from "@/lib/coin";
import { explorerAccount, FACTORY_ID } from "@/lib/config";
import { formatNear, yoctoToNear } from "@/lib/format";
import { accessKeyCount, getCoin, getConfig, viewCall, type FactoryConfig } from "@/lib/near";
import { call, errorText, useWallet } from "@/lib/wallet";
import { TxNote, type Tx } from "./tx-note";
import { Amount, CoinIcon } from "./ui";

type Preset = "light" | "standard" | "high";

// Fund fees per preset in percent (coin contract, FeePreset::fund_bps). Protocol fee is 0.5% of buys.
const PRESETS: Array<{ id: Preset; label: string; buy: number; sell: number; note: string }> = [
  { id: "light", label: "Light", buy: 0.5, sell: 1, note: "Cheapest trades, thinnest fund." },
  { id: "standard", label: "Standard", buy: 1.5, sell: 2, note: "The default balance." },
  { id: "high", label: "High", buy: 3, sell: 5, note: "Biggest fund, most loyalty pay." },
];

const MAX_ICON_BYTES = 2048;
const SYMBOL_RE = /^[a-z0-9]{2,10}$/;

/** Form for `create_coin` on the factory. Everything chosen here is locked forever at launch. */
export function LaunchForm() {
  const { accountId, connect, send } = useWallet();
  const [config, setConfig] = useState<FactoryConfig | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>("standard");
  const [demo, setDemo] = useState(true);
  const [dayLen, setDayLen] = useState("10");
  const [taken, setTaken] = useState<{ symbol: string; taken: boolean } | null>(null);
  const [tx, setTx] = useState<Tx | null>(null);
  const [launched, setLaunched] = useState<string | null>(null);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => {});
  }, []);

  // Live symbol check against the factory registry (debounced).
  useEffect(() => {
    if (!SYMBOL_RE.test(symbol)) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      getCoin(symbol, ctrl.signal)
        .then((c) => setTaken({ symbol, taken: !!c }))
        .catch(() => {});
    }, 300);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [symbol]);

  const day = demo ? Number(dayLen) : 86400;
  const symbolTaken = taken?.symbol === symbol && taken.taken;
  const problems = {
    name: name.trim().length === 0 ? "Give it a name." : [...name.trim()].length > 32 ? "32 characters at most." : null,
    symbol: !symbol
      ? "Pick a symbol."
      : !SYMBOL_RE.test(symbol)
        ? "2 to 10 characters, a to z and 0 to 9."
        : symbolTaken
          ? "Taken. Try another."
          : null,
    day: !Number.isInteger(day) || day < 10 || day > 86400 ? "Between 10 and 86400 seconds." : null,
  };
  const checked = taken?.symbol === symbol;
  const ready = !problems.name && !problems.symbol && !problems.day && checked && !!config && tx?.state !== "pending";
  const coinId = `${symbol || "symbol"}.${FACTORY_ID}`;

  const onIcon = async (file: File | undefined) => {
    setIconError(null);
    if (!file) return;
    try {
      setIcon(await shrinkIcon(file));
    } catch (e) {
      setIcon(null);
      setIconError(errorText(e));
    }
  };

  const launch = async () => {
    if (!accountId) {
      connect().catch((e) => setTx({ state: "error", text: errorText(e) }));
      return;
    }
    if (!config) return;
    setTx({ state: "pending", text: "Confirm in your wallet..." });
    try {
      const res = await send(FACTORY_ID, [
        call(
          "create_coin",
          { name: name.trim(), symbol, icon, fee_preset: preset, day_length_sec: day },
          GAS.launch,
          config.launch_deposit,
        ),
      ]);
      // The factory registers the coin in its callback. Confirm it really landed.
      const coin = await getCoin(symbol);
      if (coin) {
        setLaunched(coin.account_id);
        setTx({ state: "done", text: "Launched.", hash: res.hash });
      } else {
        const refund = await viewCall<string>(FACTORY_ID, "pending_refund", { account_id: accountId }).catch(() => "0");
        setTx({
          state: "error",
          text:
            BigInt(refund) > 0n
              ? `The launch failed. ${formatNear(yoctoToNear(refund), 3)} NEAR waits for you as a refund (withdraw_refund on the factory).`
              : "The launch did not register. Check the transaction.",
          hash: res.hash,
        });
      }
    } catch (e) {
      setTx({ state: "error", text: errorText(e) });
    }
  };

  if (launched) return <Launched coinId={launched} name={name.trim()} symbol={symbol} icon={icon} />;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-32 pt-20 sm:px-8">
      <h1 className="display text-5xl leading-none sm:text-8xl">Launch a coin</h1>
      <p className="label mt-5 leading-relaxed text-muted">
        One transaction. No premine, no owner, no keys.
        <br />
        What you pick here can never be changed.
      </p>

      <div className="mt-16 grid gap-12 lg:grid-cols-[1fr_400px]">
        {/* form */}
        <div className="space-y-12">
          <Field n="01" label="Name" error={name ? problems.name : null}>
            <input
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seato"
              className="w-full rounded-xl border border-line bg-panel px-4 py-4 text-2xl font-semibold outline-none placeholder:text-line focus:border-hazard"
            />
          </Field>

          <Field
            n="02"
            label="Symbol"
            error={symbol ? problems.symbol : null}
            hint={
              <>
                Coin address <span className="text-bone">{coinId}</span>
                {checked && !symbolTaken && SYMBOL_RE.test(symbol) && <span className="ml-3 text-hud">Available</span>}
              </>
            }
          >
            <div className="flex items-center rounded-xl border border-line bg-panel px-4 focus-within:border-hazard">
              <span className="display text-2xl text-muted">$</span>
              <input
                value={symbol}
                maxLength={10}
                onChange={(e) => setSymbol(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
                placeholder="seato"
                className="w-full bg-transparent px-2 py-4 text-2xl font-semibold uppercase outline-none placeholder:normal-case placeholder:text-line"
              />
            </div>
          </Field>

          <Field n="03" label="Icon (optional)" error={iconError} hint="Square images work best. It is stored on chain, shrunk to 2 KB.">
            <div className="flex items-center gap-5">
              <CoinIcon icon={icon} symbol={symbol || "?"} className="h-16 w-16" />
              <label className="label cursor-pointer rounded-full border border-line px-5 py-3 text-bone transition-colors hover:border-hazard hover:text-hazard">
                Upload image
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => onIcon(e.target.files?.[0])} />
              </label>
              {icon && (
                <button type="button" onClick={() => setIcon(null)} className="label text-muted transition-colors hover:text-eject">
                  Remove
                </button>
              )}
            </div>
          </Field>

          <Field n="04" label="Fee preset" hint="Fund fees go into the Ejecto Fund and are paid back to holders at EJECT. Protocol fee: 0.5% of buys.">
            <div className="grid gap-3 sm:grid-cols-3">
              {PRESETS.map((p) => {
                const on = preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreset(p.id)}
                    aria-pressed={on}
                    className={`group relative overflow-hidden rounded-xl border p-5 text-left transition-colors ${
                      on ? "border-hazard bg-hazard text-ink" : "border-line bg-panel hover:border-bone"
                    }`}
                  >
                    <div className="display text-xl">{p.label}</div>
                    <div className={`label mt-3 tabular-nums ${on ? "text-ink" : "text-bone"}`}>
                      Buy {p.buy}% / Sell {p.sell}%
                    </div>
                    <div className={`label mt-2 leading-relaxed ${on ? "text-ink/70" : "text-muted"}`}>{p.note}</div>
                  </button>
                );
              })}
            </div>
          </Field>

          <Field n="05" label="Clock" error={demo ? problems.day : null} hint="Demo time makes a day pass in seconds, so EJECT can be shown live. Real coins use 24 hours.">
            <div className="flex flex-wrap items-center gap-4">
              <div className="inline-flex rounded-full border border-line p-1">
                {[
                  { on: true, label: "Demo time" },
                  { on: false, label: "Real days" },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => setDemo(o.on)}
                    className={`label rounded-full px-4 py-2 transition-colors ${demo === o.on ? "bg-hazard font-bold text-ink" : "text-muted hover:text-bone"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {demo && (
                <label className="label flex items-center gap-3 text-muted">
                  1 day =
                  <input
                    value={dayLen}
                    inputMode="numeric"
                    onChange={(e) => setDayLen(e.target.value.replace(/\D/g, ""))}
                    className="w-20 rounded-lg border border-line bg-panel px-3 py-2 text-center text-base text-bone outline-none focus:border-hazard"
                  />
                  seconds
                </label>
              )}
            </div>
          </Field>
        </div>

        {/* preview and launch */}
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-2xl border border-line bg-panel">
            <div className="hazard-stripes h-3" />
            <div className="p-6">
              <div className="label text-muted">Preview</div>
              <div className="mt-5 flex items-center gap-4">
                <CoinIcon icon={icon} symbol={symbol || "?"} className="h-14 w-14" />
                <div className="min-w-0">
                  <div className="truncate text-2xl font-semibold tracking-tight">{name.trim() || "Your coin"}</div>
                  <div className="label mt-1 text-muted">${(symbol || "symbol").toUpperCase()}</div>
                </div>
              </div>

              <ul className="label mt-6 space-y-2.5 border-t border-line pt-5 text-muted">
                <Locked>No admin, no access keys</Locked>
                <Locked>Supply starts at 0, no premine</Locked>
                <Locked>Fees and clock fixed at launch</Locked>
                <Locked>EJECT open to anyone once the coin dies</Locked>
              </ul>

              <div className="mt-6 flex items-end justify-between border-t border-line pt-5">
                <div>
                  <div className="label text-muted">Launch cost</div>
                  <div className="label mt-1 text-muted">Pays the coin&apos;s storage</div>
                </div>
                <div className="text-3xl font-semibold tabular-nums">
                  <Amount>{config ? formatNear(yoctoToNear(config.launch_deposit), 2) : "..."}</Amount>
                </div>
              </div>

              <button
                type="button"
                onClick={launch}
                disabled={accountId ? !ready : false}
                className="display mt-6 w-full rounded-xl bg-hazard py-4 text-xl text-ink transition-transform enabled:hover:-translate-y-0.5 disabled:opacity-40"
              >
                {!accountId ? "Connect wallet" : tx?.state === "pending" ? "Launching..." : `Launch ${symbol ? "$" + symbol.toUpperCase() : ""}`}
              </button>
              <TxNote tx={tx} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({
  n,
  label,
  hint,
  error,
  children,
}: {
  n: string;
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="label mb-4 text-bone">
        <span className="mr-3 text-muted">[{n}]</span>
        {label}
      </div>
      {children}
      {error ? <p className="label mt-3 text-eject">{error}</p> : hint ? <p className="label mt-3 leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

function Locked({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="h-1.5 w-1.5 shrink-0 bg-hazard" />
      {children}
    </li>
  );
}

/** Success state: the coin is live, with proof that it has no keys. */
function Launched({ coinId, name, symbol, icon }: { coinId: string; name: string; symbol: string; icon: string | null }) {
  const [keys, setKeys] = useState<number | null>(null);
  useEffect(() => {
    accessKeyCount(coinId).then(setKeys).catch(() => {});
  }, [coinId]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-4 py-24 text-center">
      <CoinIcon icon={icon} symbol={symbol} className="h-24 w-24" />
      <p className="label mt-8 text-hud">Coin is live</p>
      <h1 className="display mt-3 text-5xl leading-none sm:text-7xl">{name}</h1>
      <p className="label mt-4 text-muted">{coinId}</p>
      <a
        href={explorerAccount(coinId)}
        target="_blank"
        rel="noreferrer"
        className="label mt-8 inline-flex items-center gap-3 rounded-full border border-line px-5 py-3 transition-colors hover:border-hud"
      >
        <span className={`h-2 w-2 rounded-full ${keys === 0 ? "bg-hud shadow-[0_0_8px_2px_rgb(61_220_132_/_0.6)]" : "bg-muted"}`} />
        {keys === null ? "Checking access keys..." : `${keys} access keys. Check it on the explorer.`}
      </a>
      <Link
        href={`/coin/?id=${coinId}`}
        className="display mt-10 rounded-full bg-hazard px-10 py-5 text-xl text-ink transition-transform hover:-translate-y-1"
      >
        Open the coin
      </Link>
    </div>
  );
}

/** Resize to a small square and re-encode until the data URL fits the contract's 2 KB limit. */
async function shrinkIcon(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Pick an image file.");
  // A small SVG stays vector (sharp at every size) when it already fits.
  if (file.type === "image/svg+xml" && file.size <= MAX_ICON_BYTES) {
    const url = await new Promise<string>((ok, fail) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => fail(new Error("Could not read the file."));
      r.readAsDataURL(file);
    });
    if (url.length <= MAX_ICON_BYTES) return url;
  }
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize images.");
  for (const size of [64, 48, 40, 32]) {
    canvas.width = size;
    canvas.height = size;
    // cover crop to a square
    const s = Math.min(bitmap.width, bitmap.height);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(bitmap, (bitmap.width - s) / 2, (bitmap.height - s) / 2, s, s, 0, 0, size, size);
    for (const q of [0.8, 0.6, 0.45, 0.3]) {
      const url = canvas.toDataURL("image/webp", q);
      if (url.startsWith("data:image/webp") && url.length <= MAX_ICON_BYTES) return url;
    }
    const png = canvas.toDataURL("image/png");
    if (png.length <= MAX_ICON_BYTES) return png;
  }
  throw new Error("Could not fit this image in 2 KB. Try a simpler one.");
}

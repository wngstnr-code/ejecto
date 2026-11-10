"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CoinView } from "@/components/app/coin-view";

/** /coin/?id=<coin account>. A query parameter, because coins are created at runtime (static export). */
export default function CoinPage() {
  return (
    <Suspense>
      <CoinFromQuery />
    </Suspense>
  );
}

function CoinFromQuery() {
  const id = useSearchParams().get("id");
  return <CoinView key={id ?? ""} id={id} />;
}

"use client";

import dynamic from "next/dynamic";

// WebGL only runs in the browser, so the stage is loaded on the client.
const PilotStage = dynamic(() => import("./pilot-stage"), { ssr: false, loading: () => null });

export function PilotLayer() {
  return <PilotStage />;
}

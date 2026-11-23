"use client";

import dynamic from "next/dynamic";

// Camera, MediaPipe and WebGL only exist in the browser.
const TryOnSpike = dynamic(() => import("@/components/TryOnSpike"), { ssr: false });

export default function Page() {
  return <TryOnSpike />;
}

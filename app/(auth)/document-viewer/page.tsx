"use client";

import dynamic from "next/dynamic";

const DocumentViewerClient = dynamic(
  () => import("./DocumentViewerClient"),
  {
    ssr: false,
  }
);

export default function DocumentViewerPage() {
  return <DocumentViewerClient />;
}

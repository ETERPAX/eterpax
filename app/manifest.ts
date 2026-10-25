import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ETERPAX",
    short_name: "ETERPAX",
    description: "Protect what matters. Forever. Your private digital legacy.",
    start_url: "/welcome",
    scope: "/",
    display: "standalone",
    background_color: "#F7F8FA",
    theme_color: "#102A43",
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

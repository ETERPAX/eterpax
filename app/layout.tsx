import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = { themeColor: "#102A43" };

export const metadata: Metadata = {
  applicationName: "ETERPAX",
  appleWebApp: { capable: true, title: "ETERPAX", statusBarStyle: "default" },
  title: "ETERPAX — Protect what matters. Forever.",
  description:
    "Secure your memories, messages, passwords and digital legacy with military-grade encryption.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#F7F8FA]">
  <LanguageProvider>{children}</LanguageProvider>
</body>
</html>
  );
}

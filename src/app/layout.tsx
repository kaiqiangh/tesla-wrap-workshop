import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Observability } from "./observability";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "WrapForge — Tesla wrap workshop",
  description:
    "Build from Tesla's published templates and share what you create.",
  alternates: { canonical: "/" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${geist.variable} ${mono.variable}`}>
        {children}
        <Observability />
      </body>
    </html>
  );
}

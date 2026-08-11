import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { readPublicEnvironment } from "@/lib/env";

import { Observability } from "./observability";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const environment = readPublicEnvironment(process.env);

export const metadata: Metadata = {
  metadataBase: new URL(environment.NEXT_PUBLIC_SITE_URL),
  title: "WrapForge — Tesla wrap workshop",
  description:
    "Build from Tesla's published templates and share what you create.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "WrapForge — Tesla wrap workshop",
    description:
      "Build from Tesla's published templates and share what you create.",
    url: "/",
    siteName: "WrapForge",
    type: "website",
  },
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

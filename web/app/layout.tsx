import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { BASE_PATH, SITE_URL } from "@/lib/config";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

const DESCRIPTION =
  "Every Ejecto coin trades on a bonding curve with a built-in Ejecto Fund. When the coin dies, anyone can press EJECT and every holder claims a fair share. Keyless contracts on NEAR.";

// Static brand assets in public/brand (og.png and apple-icon.png were rendered once from
// public/brand/ejecto-mark.svg). Full URLs, because social previews need absolute links.
const OG_IMAGE = { url: `${SITE_URL}/brand/og.png`, width: 1200, height: 630, alt: "Ejecto: the memecoin with an ejection seat" };

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Ejecto: the memecoin with an ejection seat",
  description: DESCRIPTION,
  icons: {
    icon: [{ url: `${BASE_PATH}/brand/ejecto-mark.svg`, type: "image/svg+xml" }],
    apple: `${BASE_PATH}/brand/apple-icon.png`,
  },
  openGraph: { title: "Ejecto", description: DESCRIPTION, type: "website", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: "Ejecto", description: DESCRIPTION, images: [OG_IMAGE.url] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh bg-ink text-bone" suppressHydrationWarning>{children}</body>
    </html>
  );
}

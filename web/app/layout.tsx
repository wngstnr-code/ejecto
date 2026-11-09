import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Ejecto: the memecoin with an ejection seat",
  description:
    "Every Ejecto coin trades on a bonding curve with a built-in Ejecto Fund. When the coin dies, anyone can press EJECT and every holder claims a fair share. Keyless contracts on NEAR.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh bg-ink text-bone" suppressHydrationWarning>{children}</body>
    </html>
  );
}

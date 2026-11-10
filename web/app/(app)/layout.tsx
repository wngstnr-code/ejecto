import { AppHeader } from "@/components/app/app-header";
import { ScrollBar } from "@/components/site/scroll-bar";
import { AppFooter } from "@/components/app/app-footer";
import { SmoothScroll } from "@/components/site/smooth-scroll";
import { WalletProvider } from "@/lib/wallet";

/** Shell of the app pages (coins, coin, launch): wallet, header, footer. No preloader, no 3D layer. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <WalletProvider>
      <SmoothScroll />
      <ScrollBar />
      <AppHeader />
      <main className="min-h-dvh pt-16">{children}</main>
      <AppFooter />
    </WalletProvider>
  );
}

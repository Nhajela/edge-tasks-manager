import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE_URL } from "@/lib/constants";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Edge Tasks: ask anyone at Edge City, right from Telegram", template: "%s · Edge Tasks" },
  description:
    "Raise a request for anyone at Edge City India from any Telegram group, and track what you asked and what's asked of you. A community project, not an official Edge City app.",
  icons: { icon: "/icon.svg" },
  robots: { index: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        {/* light by default; dark only when picked with the header toggle */}
        <ThemeProvider attribute={["class", "data-theme"]} defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
          <SiteFooter />
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}

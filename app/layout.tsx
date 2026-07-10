import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import "./globals.css";
import { PHProvider } from "./providers";
import { Toaster } from "@/components/ui/sonner";

const bodySans = Hanken_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
});

const displaySerif = Newsreader({
  variable: "--font-heading",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "AI Career Coach",
  description:
    "Career coaching grounded in your uploaded résumé — with calibrated abstention gates that refuse to invent answers, and a keyless demo.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf6ef" },
    { media: "(prefers-color-scheme: dark)", color: "#171310" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${bodySans.variable} ${displaySerif.variable} antialiased`}
      >
        <PHProvider>{children}</PHProvider>
        <Toaster richColors closeButton />
      </body>
    </html>
  );
}

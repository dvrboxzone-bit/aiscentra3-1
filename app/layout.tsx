import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter-runtime",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AIscentra — Intelligence Observatory",
  description: "Observe. Analyze. Accelerate the Future. The global AI ecosystem intelligence platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Revert Finance Bot | LP Optimization",
  description: "Concentrated liquidity optimization for Uniswap V3",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,_var(--primary-glow),_transparent_40%)]" />
        <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_bottom_left,_rgba(139,92,246,0.2),_transparent_40%)]" />
        {children}
      </body>
    </html>
  );
}

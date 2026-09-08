import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Контур проектов · Финансы Битрикс24",
  description: "Совместный учёт доходов, расходов и рентабельности проектов в Битрикс24.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}

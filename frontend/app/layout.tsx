import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "./components/Sidebar/sidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bill-Powered Pay",
  description: "Curated a bill-powered pay",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      {/* if column width changes, sidebar width must match */}
      <body className="min-h-full grid grid-cols-[2rem_1fr] sm:grid-cols-[9rem_1fr]">
        <Sidebar />
        {children}
      </body>
    </html>
  );
}

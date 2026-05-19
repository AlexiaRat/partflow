import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PartFlow — Multi-Agent Quote Automation",
  description:
    "An autonomous multi-agent system that classifies inbound parts-request emails, identifies the right SKU, calculates pricing, and drafts the reply.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AirRetail SDR — AI Sales Platform',
  description: 'AI-powered outbound sales development platform for AirRetail Technologies',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

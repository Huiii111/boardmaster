import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BoardMaster — AI-Powered Virtual Electronics Laboratory',
  description:
    'Build and test real circuits on a 3D breadboard, get deterministic electrical analysis, and work through faults with an evidence-based AI teaching assistant.',
  applicationName: 'BoardMaster',
  keywords: ['electronics', 'breadboard', 'LED circuit', 'PCB', 'education', 'simulation'],
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#1a212b',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}

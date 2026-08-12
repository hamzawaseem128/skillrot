import type { Metadata } from 'next';
import { Inter, Outfit } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  weight: ['600', '700'],
});

export const metadata: Metadata = {
  title: 'SkillRot — AI-Powered Career Mastery',
  description: 'Transform boring lectures into career-building superpowers. Upload course material, get AI-generated learning cards, ask questions, and map your career path.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/*
          Material Symbols is an icon font and is not part of the Google Fonts
          catalogue that `next/font/google` ships, so it has to be linked
          directly. The lint rule below targets `pages/_document.js`, where a
          stylesheet link would leak across pages — in an App Router root layout
          it applies to every route by design.
        */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${inter.variable} ${outfit.variable} font-sans bg-[#0f131d] text-[#dfe2f1] min-h-screen antialiased`}>
        <div className="bg-mesh" />
        <Navbar />
        <main className="pt-16">
          {children}
        </main>
      </body>
    </html>
  );
}

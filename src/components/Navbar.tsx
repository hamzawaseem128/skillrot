'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const navLinks = [
  { href: '/upload', label: 'Study', icon: 'auto_stories' },
  { href: '/roadmap', label: 'Career Roadmap', icon: 'route' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 glass-panel border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#8083ff] to-[#4cd7f6] flex items-center justify-center group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-white" style={{ fontSize: '18px' }}>genetics</span>
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-[#c0c1ff] to-[#4cd7f6] bg-clip-text text-transparent" style={{ fontFamily: 'var(--font-outfit)' }}>
                SkillRot
              </span>
            </Link>

            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={pathname === link.href ? 'page' : undefined}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    pathname === link.href
                      ? 'bg-[#8083ff]/20 text-[#c0c1ff]'
                      : 'text-[#c7c4d7] hover:text-[#dfe2f1] hover:bg-white/5'
                  }`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{link.icon}</span>
                  {link.label}
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/upload"
                className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] text-[#0f131d] hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload_file</span>
                Upload
              </Link>
              <button
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileOpen}
                className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
              >
                <span className="material-symbols-outlined text-[#dfe2f1]">{mobileOpen ? 'close' : 'menu'}</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="absolute right-0 top-16 w-64 glass-panel rounded-bl-xl p-4 fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                    pathname === link.href
                      ? 'bg-[#8083ff]/20 text-[#c0c1ff]'
                      : 'text-[#c7c4d7] hover:text-[#dfe2f1] hover:bg-white/5'
                  }`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{link.icon}</span>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

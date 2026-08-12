import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  glowOnHover?: boolean;
  onClick?: () => void;
}

export default function GlassCard({ children, className = '', glowOnHover = false, onClick }: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      className={`glass-panel rounded-xl transition-all duration-300 ${
        glowOnHover ? 'glow-hover cursor-pointer hover:scale-[1.02]' : ''
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

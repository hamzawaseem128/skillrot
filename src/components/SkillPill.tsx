interface SkillPillProps {
  skill: string;
  variant?: 'have' | 'missing' | 'neutral';
}

export default function SkillPill({ skill, variant = 'neutral' }: SkillPillProps) {
  const styles = {
    have: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    missing: 'bg-[#ff516a]/15 text-[#ffb2b7] border-[#ff516a]/20',
    neutral: 'bg-[#262a35] text-[#c7c4d7] border-[#464554]',
  };

  const icons = {
    have: 'check_circle',
    missing: 'cancel',
    neutral: 'circle',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${styles[variant]}`}>
      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>{icons[variant]}</span>
      {skill}
    </span>
  );
}

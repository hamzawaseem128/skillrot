'use client';

interface LoadingStateProps {
  steps: string[];
  currentStep: number;
}

export default function LoadingState({ steps, currentStep }: LoadingStateProps) {
  return (
    <div className="max-w-md mx-auto text-center">
      <div className="relative w-20 h-20 mx-auto mb-8">
        <div className="absolute inset-0 rounded-full border-2 border-[#464554]" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#8083ff] border-r-[#4cd7f6] spin-slow" />
        <div className="absolute inset-2 rounded-full border-2 border-transparent border-b-[#c0c1ff] spin-slow" style={{ animationDirection: 'reverse', animationDuration: '2s' }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="material-symbols-outlined text-[#c0c1ff]" style={{ fontSize: '24px' }}>auto_awesome</span>
        </div>
      </div>

      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-500 ${
            i < currentStep ? 'bg-emerald-500/10' : i === currentStep ? 'bg-[#8083ff]/10 glow-active' : 'opacity-40'
          }`}>
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
              {i < currentStep ? (
                <span className="material-symbols-outlined text-emerald-400" style={{ fontSize: '20px' }}>check_circle</span>
              ) : i === currentStep ? (
                <div className="w-5 h-5 rounded-full border-2 border-[#8083ff] border-t-transparent animate-spin" />
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-[#464554]" />
              )}
            </div>
            <span className={`text-sm font-medium ${
              i < currentStep ? 'text-emerald-400' : i === currentStep ? 'text-[#c0c1ff]' : 'text-[#908fa0]'
            }`} style={{ fontFamily: 'var(--font-outfit)' }}>
              {step}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

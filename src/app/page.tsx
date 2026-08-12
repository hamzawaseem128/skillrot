import Link from 'next/link';
import Footer from '@/components/Footer';

const STEPS = [
  {
    icon: 'upload_file',
    title: 'Upload your lecture',
    body: 'Drop in a PDF of your slides or notes. We pull out the text and figure out what actually matters.',
  },
  {
    icon: 'style',
    title: 'Swipe through the cards',
    body: 'Dense academic writing becomes 5-8 bite-sized cards in plain language — the way you actually read.',
  },
  {
    icon: 'route',
    title: 'See where it takes you',
    body: 'Every upload adds to your skill profile and updates the jobs you are qualified for, and the gaps left.',
  },
];

const FEATURES = [
  {
    icon: 'auto_awesome',
    title: 'Learning cards, not walls of text',
    body: 'Gemini rewrites your material as an Instagram-style carousel. Concepts first, jargon defined, ordered the way you should learn them.',
    accent: 'from-[#8083ff] to-[#c0c1ff]',
  },
  {
    icon: 'plagiarism',
    title: 'Answers you can actually trust',
    body: 'Ask anything about your document. Retrieval grounds every answer in your own material and cites the exact page — no invented facts.',
    accent: 'from-[#4cd7f6] to-[#03b5d3]',
  },
  {
    icon: 'workspace_premium',
    title: 'Coursework mapped to real roles',
    body: 'Skills are extracted from what you upload and matched against a curated set of entry-level roles, showing what you have and what is missing.',
    accent: 'from-emerald-400 to-teal-400',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel text-xs text-[#c7c4d7] mb-8 slide-up">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4cd7f6] pulse-glow" />
          AI-powered social learning for university students
        </div>

        <h1
          className="text-4xl sm:text-6xl font-bold leading-[1.1] tracking-tight text-[#dfe2f1] slide-up"
          style={{ fontFamily: 'var(--font-outfit)' }}
        >
          Your lectures are boring.
          <br />
          <span className="bg-gradient-to-r from-[#8083ff] via-[#c0c1ff] to-[#4cd7f6] bg-clip-text text-transparent">
            Your career doesn&apos;t have to be.
          </span>
        </h1>

        <p className="mt-6 text-lg text-[#c7c4d7] max-w-2xl mx-auto leading-relaxed slide-up">
          SkillRot turns your course material into bite-sized visual cards you will actually remember —
          then shows you exactly which jobs that knowledge is qualifying you for.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center slide-up">
          <Link
            href="/upload"
            className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] text-[#0f131d] font-semibold hover:opacity-90 transition-all hover:scale-[1.02]"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>upload_file</span>
            Upload your first lecture
          </Link>
          <Link
            href="/roadmap"
            className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl glass-panel text-[#dfe2f1] font-medium glow-hover transition-all"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>route</span>
            See the career roadmap
          </Link>
        </div>

        <p className="mt-5 text-xs text-[#908fa0]">No account needed · PDF slides and notes · Under 30 seconds</p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid gap-5 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="glass-panel rounded-2xl p-6 glow-hover transition-all">
              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${feature.accent} flex items-center justify-center mb-4`}>
                <span className="material-symbols-outlined text-[#0f131d]" style={{ fontSize: '22px' }}>
                  {feature.icon}
                </span>
              </div>
              <h3 className="text-base font-bold text-[#dfe2f1] mb-2" style={{ fontFamily: 'var(--font-outfit)' }}>
                {feature.title}
              </h3>
              <p className="text-sm text-[#c7c4d7] leading-relaxed">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2
          className="text-2xl sm:text-3xl font-bold text-center text-[#dfe2f1] mb-3"
          style={{ fontFamily: 'var(--font-outfit)' }}
        >
          Three steps, under three minutes
        </h2>
        <p className="text-center text-[#908fa0] text-sm mb-12">From a PDF you dread to a career path you can see.</p>

        <ol className="relative grid gap-8 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-9 h-9 rounded-full glass-panel flex items-center justify-center text-sm font-bold text-[#c0c1ff]">
                  {index + 1}
                </span>
                <span className="material-symbols-outlined text-[#4cd7f6]" style={{ fontSize: '22px' }}>
                  {step.icon}
                </span>
              </div>
              <h3 className="text-base font-semibold text-[#dfe2f1] mb-2" style={{ fontFamily: 'var(--font-outfit)' }}>
                {step.title}
              </h3>
              <p className="text-sm text-[#908fa0] leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <div className="glass-panel rounded-2xl p-8 sm:p-10 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#8083ff] via-[#4cd7f6] to-[#8083ff]" />
          <h2 className="text-2xl font-bold text-[#dfe2f1] mb-3" style={{ fontFamily: 'var(--font-outfit)' }}>
            Ready to stop re-reading slide 47?
          </h2>
          <p className="text-sm text-[#c7c4d7] mb-6 max-w-md mx-auto">
            Upload one lecture and see your first learning cards and job matches in about twenty seconds.
          </p>
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 px-7 py-3 rounded-xl bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] text-[#0f131d] font-semibold hover:opacity-90 transition-opacity"
          >
            Get started
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>arrow_forward</span>
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}

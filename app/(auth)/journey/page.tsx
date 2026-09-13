import Link from "next/link";

const steps = [
  {
    number: "01",
    title: "Create your first Message",
    description:
      "Start with something personal for someone who matters to you.",
  },
  {
    number: "02",
    title: "Choose who it's for",
    description:
      "Decide exactly who you want to leave your Message to.",
  },
  {
    number: "03",
    title: "Make it yours",
    description:
      "Add your words, voice, video, photos or documents.",
  },
  {
    number: "04",
    title: "Choose your Guardians",
    description:
      "Select trusted people who can help verify your ETERPAX protocol when needed.",
  },
  {
    number: "05",
    title: "Set your Check-in",
    description:
      "Choose how ETERPAX stays connected with you and what happens when a check-in is missed.",
  },
  {
    number: "06",
    title: "Protect your Journey",
    description:
      "Review your choices and activate your ETERPAX protection.",
  },
];

export default function JourneyPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#102A43]">
      {/* BACKGROUND */}
      <div className="absolute inset-0">
        <img
          src="/images/hero-family-v2.jpg"
          alt=""
          className="h-full w-full object-cover object-right"
        />

        <div className="absolute inset-0 bg-gradient-to-r from-[#071B2E]/80 via-[#071B2E]/45 to-[#071B2E]/20" />

        <div className="absolute inset-0 bg-white/5" />
      </div>

      {/* CONTENT */}
      <div className="relative z-10 min-h-screen px-6 py-8 lg:px-14 lg:py-10">
        {/* HEADER */}
        <header className="flex items-start justify-between">
          <div>
            <div className="text-2xl font-light tracking-[0.35em] text-white">
              ETERPAX
            </div>

            <div className="mt-3 max-w-xs text-xs font-medium leading-5 tracking-wide text-white/75">
              Confidence is designed.
              <br />
              Trust is earned.
              <br />
              Continuity is intentional.
            </div>
          </div>

          <div className="text-sm font-medium tracking-wide text-white/75">
            Your private journey
          </div>
        </header>

        {/* JOURNEY CARD */}
        <div className="mx-auto mt-5 w-full max-w-4xl rounded-[36px] border border-white/20 bg-white/90 p-7 shadow-2xl backdrop-blur-xl md:p-10 lg:mt-12 lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.5fr] lg:gap-14">
            {/* INTRO */}
            <section className="flex flex-col justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.24em] text-[#0A7BA8]">
                  Your journey
                </p>

                <h1 className="mt-5 max-w-md font-serif text-5xl leading-[1.02] tracking-tight text-[#102A43] md:text-6xl">
                  Your ETERPAX
                  <br />
                  Journey
                </h1>

                <p className="mt-7 max-w-md text-lg leading-8 text-[#334E68]">
                  A simple path to create something that stays — personal,
                  private and entirely yours.
                </p>
              </div>

              
            </section>

            {/* STEPS */}
            <section>
              <div className="space-y-3">
                {steps.map((step) => (
                  <div
                  
                  key={step.number}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/75 px-3 py-2.5 transition-all duration-200 hover:bg-white"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAF3F7] text-xs font-semibold text-[#0A7BA8]">
                    {step.number}
                  </div>
                
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold leading-5 text-[#102A43] md:text-base">
                      {step.title}
                    </h2>
                
                    <p className="mt-0.5 text-xs leading-5 text-[#627D98]">
                      {step.description}
                    </p>
                  </div>
                </div>
                ))}
              </div>

              {/* ACTION */}
              <div className="mt-8 text-center">
                <Link
                  href="/your-messages?new=true"
                  className="inline-flex items-center rounded-full bg-[#0A7BA8] px-10 py-4 text-lg font-medium text-white shadow-xl shadow-sky-900/15 transition-all duration-300 hover:scale-[1.02] hover:bg-[#08698F] active:scale-[0.99]"
                >
                  Let&apos;s Begin
                  <span className="ml-3">→</span>
                </Link>

                <p className="mt-4 text-sm text-slate-500">
                  You&apos;re in control of what you create, who it&apos;s for,
                  and when it&apos;s ready.
                </p>
              </div>
            </section>
          </div>

          {/* PRIVACY */}
          <div className="mt-10 border-t border-slate-200 pt-6 text-center">
            <p className="text-sm text-slate-500">
              🔒 Your ETERPAX space is private and designed to keep your
              Messages protected.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
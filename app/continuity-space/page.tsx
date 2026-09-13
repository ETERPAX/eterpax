"use client";

export default function ContinuitySpacePage() {
  return (
    <main
  className="min-h-screen bg-cover bg-center bg-fixed text-[#102A43]"
  style={{ backgroundImage: "url('/images/hero-family-v2.jpg')" }}
>
      <header className="flex items-center justify-between px-8 py-6 md:px-14">
        <div>
          <div className="text-xl font-medium tracking-[0.28em]">
            ETERPAX
          </div>

          <div className="mt-1 text-[9px] leading-[1.35] tracking-[0.12em] text-[#64748B]">
            Confidence is designed.
            <br />
            Trust is earned.
            <br />
            Continuity is intentional.
          </div>
        </div>

        <div className="text-sm text-[#64748B]">
          Your private continuity space
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-20 pt-16 md:px-10 md:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.22em] text-[#0A7BA8]">
            Your Continuity Space
          </p>

          <h1 className="font-serif text-4xl font-light tracking-tight md:text-5xl">
            Leave what matters to you.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Create private messages, memories, wishes, and anything else
            you want to preserve for the people you choose.
          </p>
        </div>
        <div className="mx-auto mt-12 max-w-4xl rounded-[28px] border border-slate-200 bg-white p-8 shadow-[0_25px_80px_rgba(16,42,67,0.08)] md:p-10">
          <div className="text-center">
            <h2 className="font-serif text-2xl font-light text-[#102A43] md:text-3xl">
              What would you like to leave?
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-500">
              Create something meaningful for the people you choose.
            </p>
            <div className="mt-8 space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-5 py-4 text-left transition hover:border-[#0A7BA8] hover:bg-[#F8FCFD]"
            >
              <div>
                <span className="block text-base font-medium text-[#102A43]">
                  A Letter
                </span>

                <span className="mt-1 block text-sm text-slate-500">
                  Write something personal for someone important to you.
                </span>
              </div>
            </button>

            <button
              type="button"
              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-5 py-4 text-left transition hover:border-[#0A7BA8] hover:bg-[#F8FCFD]"
            >
              <div>
                <span className="block text-base font-medium text-[#102A43]">
                  A Message
                </span>

                <span className="mt-1 block text-sm text-slate-500">
                  Leave words you want someone to receive in the future.
                </span>
              </div>
            </button>

            <button
              type="button"
              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-5 py-4 text-left transition hover:border-[#0A7BA8] hover:bg-[#F8FCFD]"
            >
              <div>
                <span className="block text-base font-medium text-[#102A43]">
                  A Voice Note
                </span>

                <span className="mt-1 block text-sm text-slate-500">
                  Leave your voice, exactly as you want it remembered.
                </span>
              </div>
            </button>

            <button
              type="button"
              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-5 py-4 text-left transition hover:border-[#0A7BA8] hover:bg-[#F8FCFD]"
            >
              <div>
                <span className="block text-base font-medium text-[#102A43]">
                  A Memory
                </span>

                <span className="mt-1 block text-sm text-slate-500">
                  Preserve a story, moment, or memory that matters to you.
                </span>
              </div>
            </button>

            <button
              type="button"
              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-5 py-4 text-left transition hover:border-[#0A7BA8] hover:bg-[#F8FCFD]"
            >
              <div>
                <span className="block text-base font-medium text-[#102A43]">
                  A Wish
                </span>

                <span className="mt-1 block text-sm text-slate-500">
                  Leave an intention, request, or personal wish.
                </span>
              </div>
              <div className="mt-8 rounded-2xl bg-[#F0F7FA] px-5 py-5">
            <p className="text-sm leading-6 text-[#35627D]">
              <span className="font-medium text-[#102A43]">
                Your space, your instructions.
              </span>{" "}
              You decide what to leave, who it is for, and what should happen
              with it.
            </p>
          </div>
            </button>
          </div>
          <button
  type="button"
  onClick={() => {
    window.location.href = "/guardians";
  }}
  className="mt-8 inline-flex w-full items-center justify-center gap-3 rounded-full bg-[#0A7BA8] px-7 py-3.5 text-sm font-medium text-white transition hover:bg-[#08698F]"
>
  Continue to Guardians
  <span>→</span>
</button>
          </div>
        </div>
      </section>
    </main>
  );
}
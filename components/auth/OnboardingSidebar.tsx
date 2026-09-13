interface OnboardingSidebarProps {
    step: number;
  }
  
  export function OnboardingSidebar({
    step,
  }: OnboardingSidebarProps) {
    return (
      <aside className="hidden w-80 rounded-[32px] bg-white p-10 shadow-xl backdrop-blur lg:block">
  
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0F5C88]">
          Step {step} of 5
        </p>
  
        <div className="mt-8 h-px w-12 bg-[#C8A96A]" />
  
        <h2 className="mt-8 font-serif text-5xl leading-tight text-[#17375E]">
          Let's Get
          <br />
          Started.
        </h2>
  
        <p className="mt-6 text-base leading-8 text-neutral-600">
          Create your secure ETERPAX account and begin building your continuity
          plan.
        </p>
  
        <div className="mt-8 border-t border-neutral-200 pt-8">
  
          <p className="text-sm font-semibold text-[#17375E]">
            Your Journey
          </p>
  
          {/* Journey Steps */}
          <div className="relative mt-5">
  
            {/* Vertical connecting line */}
            <div className="absolute left-[13px] top-3 bottom-3 w-px bg-neutral-200" />
  
            {/* Step 1 */}
            <div className="relative z-10 flex items-center gap-3">
            <div
  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
    step > 1
      ? "bg-[#0F5C88] text-white"
      : step === 1
      ? "bg-[#0F5C88] text-white"
      : "border border-neutral-300 bg-white text-neutral-400"
  }`}
>
  {step > 1 ? "✓" : "1"}
</div>
  
              <p className="text-sm font-medium text-[#17375E]">
                Create Your Account
              </p>
            </div>
  
            {/* Step 2 */}
            <div className="relative z-10 mt-4 flex items-center gap-3">
            <div
  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
    step > 2
      ? "bg-[#0F5C88] text-white"
      : step === 2
      ? "bg-[#0F5C88] text-white"
      : "border border-neutral-300 bg-white text-neutral-400"
  }`}
>
  {step > 2 ? "✓" : "2"}
</div>
  
              <p className="text-sm font-medium text-neutral-500">
                Your Guidance
              </p>
            </div>
  
            {/* Step 3 */}
            <div className="relative z-10 mt-4 flex items-center gap-3">
            <div
  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
    step > 3
      ? "bg-[#0F5C88] text-white"
      : step === 3
      ? "bg-[#0F5C88] text-white"
      : "border border-neutral-300 bg-white text-neutral-400"
  }`}
>
  {step > 3 ? "✓" : "3"}
</div>
  
              <p className="text-sm font-medium text-neutral-500">
                Secure Your Plan
              </p>
            </div>
  
            {/* Step 4 */}
            <div className="relative z-10 mt-4 flex items-center gap-3">
            <div
  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
    step > 4
      ? "bg-[#0F5C88] text-white"
      : step === 4
      ? "bg-[#0F5C88] text-white"
      : "border border-neutral-300 bg-white text-neutral-400"
  }`}
>
  {step > 4 ? "✓" : "4"}
</div>
  
              <p className="text-sm font-medium text-neutral-500">
                Trusted Contacts
              </p>
            </div>
  
            {/* Step 5 */}
            <div className="relative z-10 mt-4 flex items-center gap-3">
            <div
  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
    step === 5
      ? "bg-[#0F5C88] text-white"
      : "border border-neutral-300 bg-white text-neutral-400"
  }`}
>
  5
</div>
  
              <p className="text-sm font-medium text-neutral-500">
                Activate Your Plan
              </p>
            </div>
  
          </div>
  
        </div>
  
      </aside>
    );
  }
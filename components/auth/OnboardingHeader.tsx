"use client";

interface OnboardingHeaderProps {
  step: number;
  totalSteps: number;
  onBack?: () => void;
}

export function OnboardingHeader({
  step,
  totalSteps,
}: OnboardingHeaderProps) {
  const progress = (step / totalSteps) * 100;

  return (
    <header className="mb-16 flex items-center justify-end">
      <div className="w-40">
        <div className="mb-2 flex justify-between text-xs text-neutral-500">
          <span>
            Step {step} of {totalSteps}
          </span>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-neutral-200">
          <div
            className="h-full rounded-full bg-[#0D2340] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </header>
  );
}
import { Button } from "@/design-system/ui/Button";
import { ArrowRight, Play } from "lucide-react";

export default function HeroCTA() {
  return (
    <div className="mt-12 flex flex-wrap items-center gap-8">
      {/* Primary Button */}

      <Button
  leftIcon={
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
      🛡️
    </div>
  }
  rightIcon={
    <ArrowRight
      size={20}
      className="transition-transform duration-300 group-hover:translate-x-1"
    />
  }
>
  Create My Continuity Plan
</Button>

      {/* Watch Video */}

      <button className="group flex items-center gap-3 text-[#163A63] transition-colors hover:text-[#1185A6]">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#163A63]/10 bg-white shadow-md transition-all duration-300 group-hover:scale-105 group-hover:border-[#0F5C88]">
          <Play
            size={18}
            className="ml-[2px]"
            fill="currentColor"
          />
        </div>

        <span className="text-[17px] font-medium tracking-[-0.01em]">
          Watch video
        </span>
      </button>
    </div>
  );
}
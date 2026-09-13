import HeroCTA from "./HeroCTA";
export default function HeroContent() {
    return (
      <div className="max-w-xl">
  
        {/* Brand Statement */}
  
        <p className="mb-8 text-xs font-medium uppercase tracking-[0.35em] text-[#1E8FA8]">
          CONFIDENCE IS DESIGNED.
          <br />
          TRUST IS EARNED.
          <br />
          CONTINUITY IS INTENTIONAL.
        </p>
  
        {/* Headline */}
  
        <h1 className="font-serif text-[76px] leading-[0.92] tracking-[-0.03em] font-medium text-[#17375E]">
  Protect what
  <br />
  matters{" "}
  <span className="font-normal text-[#3B8F95]">
    most.
  </span>
</h1> 
  
        {/* Gold Accent */}
  
        <div className="mt-10 h-[2px] w-16 bg-[#C9A96A]" />
  
        {/* Supporting Copy */}
  
        <p className="mt-9 max-w-[560px] text-[24px] leading-[1.65] font-normal tracking-[-0.01em] text-[#566A7F]">
  Prepare today so the people you love
  always have clarity tomorrow.
</p>     
        <HeroCTA />
      </div>
    );
  }
export const uiStyles = {
    button: {
      variant: {
        primary:
          "bg-[#0F5C88] text-white hover:bg-[#17375E] shadow-xl hover:shadow-2xl",
  
        secondary:
          "border border-[#17375E]/15 bg-white text-[#17375E] hover:bg-[#F8FAFC]",
  
        ghost:
          "bg-transparent text-[#17375E] hover:bg-[#F3F6F9]",
      },
  
      size: {
        sm: "h-10 px-4 rounded-xl text-sm",
  
        md: "px-9 py-[18px] rounded-[18px] text-lg",
  
        lg: "px-10 py-5 rounded-[18px] text-xl",
      },
  
      base:
        "group inline-flex items-center gap-4 font-medium transition-all duration-300 hover:scale-[1.02] focus:outline-none",
    },
  
    card: {
      base:
        "rounded-3xl border border-[#E7EDF4] bg-white shadow-sm transition-all hover:shadow-md",
    },
  
    headline: {
      title:
        "text-4xl font-bold tracking-tight text-slate-900 lg:text-5xl",
  
      subtitle:
        "text-lg leading-8 text-slate-600",
    },
  
    eyebrow: {
      base:
        "text-xs font-medium uppercase tracking-[0.35em] text-[#6CC6C9]",
    },
  
    container: {
      base:
        "w-full mx-auto px-6 lg:px-8",
  
      size: {
        sm: "max-w-3xl",
  
        md: "max-w-5xl",
  
        lg: "max-w-6xl",
  
        xl: "max-w-7xl",
  
        full: "max-w-full",
      },
    },
  
    section: {
      spacing: {
        sm: "py-12 lg:py-16",
  
        md: "py-16 lg:py-20",
  
        lg: "py-20 lg:py-28",
  
        xl: "py-24 lg:py-32",
      },
    },
  
    stack: {
      spacing: {
        xs: "space-y-2",
  
        sm: "space-y-4",
  
        md: "space-y-6",
  
        lg: "space-y-8",
  
        xl: "space-y-12",
      },
    },
  } as const;
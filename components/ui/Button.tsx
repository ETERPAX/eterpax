"use client";

import { ButtonHTMLAttributes } from "react";
import { ArrowRight } from "lucide-react";
import clsx from "clsx";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: boolean;
}

export function Button({
  children,
  loading = false,
  fullWidth = false,
  icon = true,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-3",
        "rounded-full",
        "bg-[#0A7BA8]",
        "px-8 py-4",
        "text-base font-medium text-white",
        "transition-all duration-300",
        "hover:bg-[#086A91]",
        "hover:shadow-xl",
        "active:scale-[0.98]",
        "disabled:cursor-not-allowed",
        "disabled:opacity-50",
        fullWidth && "w-full",
        className
      )}
      {...props}
    >
      {loading ? "Loading..." : children}

      {icon && !loading && (
        <ArrowRight className="h-5 w-5" />
      )}
    </button>
  );
}
"use client";

import { InputHTMLAttributes, ReactNode, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import clsx from "clsx";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: ReactNode;
  error?: string;
}

export function Input({
  label,
  icon,
  error,
  className,
  type,
  ...props
}: InputProps) {
  const [showPassword, setShowPassword] = useState(false);

  const inputType =
    type === "password" && showPassword ? "text" : type;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-[#0D2340]">
        {label}
      </label>

      <div
        className={clsx(
          "flex items-center gap-3",
          "rounded-2xl border border-neutral-200",
          "bg-white",
          "px-4 py-4",
          "transition-all duration-200",
          "focus-within:border-[#0A7BA8]",
          "focus-within:ring-2",
          "focus-within:ring-[#0A7BA8]/20"
        )}
      >
        {icon && (
          <div className="text-neutral-400">
            {icon}
          </div>
        )}

        <input
          type={inputType}
          className={clsx(
            "w-full bg-transparent text-[#0D2340] outline-none",
            "placeholder:text-neutral-400",
            className
          )}
          {...props}
        />

        {type === "password" && (
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="shrink-0 text-neutral-400 transition-colors hover:text-[#0D2340]"
            aria-label={
              showPassword ? "Hide password" : "Show password"
            }
          >
            {showPassword ? (
              <EyeOff size={20} />
            ) : (
              <Eye size={20} />
            )}
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
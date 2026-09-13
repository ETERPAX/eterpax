import { HTMLAttributes } from "react";

interface SectionProps extends HTMLAttributes<HTMLElement> {
  spacing?: "sm" | "md" | "lg" | "xl";
}

const spacingClasses = {
  sm: "py-12 lg:py-16",
  md: "py-16 lg:py-20",
  lg: "py-20 lg:py-28",
  xl: "py-24 lg:py-32",
};

export function Section({
  spacing = "xl",
  className = "",
  children,
  ...props
}: SectionProps) {
  return (
    <section
      className={[
        spacingClasses[spacing],
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </section>
  );
}
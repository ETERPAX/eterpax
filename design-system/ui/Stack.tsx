import { HTMLAttributes } from "react";

interface StackProps extends HTMLAttributes<HTMLDivElement> {
  space?: "xs" | "sm" | "md" | "lg" | "xl";
}

const spacing = {
  xs: "space-y-2",
  sm: "space-y-4",
  md: "space-y-6",
  lg: "space-y-8",
  xl: "space-y-12",
};

export function Stack({
  space = "md",
  className = "",
  children,
  ...props
}: StackProps) {
  return (
    <div
      className={[
        "flex",
        "flex-col",
        spacing[space],
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
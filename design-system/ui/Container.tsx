import { HTMLAttributes } from "react";

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

const maxWidths = {
  sm: "max-w-3xl",
  md: "max-w-5xl",
  lg: "max-w-6xl",
  xl: "max-w-7xl",
  full: "max-w-full",
};

export function Container({
  size = "xl",
  className = "",
  children,
  ...props
}: ContainerProps) {
  return (
    <div
      className={[
        "w-full",
        "mx-auto",
        "px-6",
        "lg:px-8",
        maxWidths[size],
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
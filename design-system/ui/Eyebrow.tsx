import { HTMLAttributes } from "react";

interface EyebrowProps extends HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode;
  align?: "left" | "center";
}

export function Eyebrow({
  children,
  align = "left",
  className = "",
  ...props
}: EyebrowProps) {
  const alignment = align === "center"
    ? "text-center items-center"
    : "text-left items-start";

  return (
    <div
      className={[
        "flex",
        "flex-col",
        alignment,
        className,
      ].join(" ")}
    >
      <p
        className="text-xs font-medium uppercase tracking-[0.35em] text-[#6CC6C9]"
        {...props}
      >
        {children}
      </p>
    </div>
  );
}
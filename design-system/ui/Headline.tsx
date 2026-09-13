import { HTMLAttributes } from "react";

interface HeadlineProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  align?: "left" | "center";
}

export function Headline({
  title,
  subtitle,
  align = "left",
  className = "",
  ...props
}: HeadlineProps) {
  const alignment = align === "center" ? "text-center" : "text-left";

  return (
    <div
      className={[
        alignment,
        "space-y-4",
        className,
      ].join(" ")}
      {...props}
    >
      <h2 className="text-4xl font-bold tracking-tight text-slate-900 lg:text-5xl">
        {title}
      </h2>

      {subtitle && (
        <p className="mx-auto max-w-3xl text-lg leading-8 text-slate-600">
          {subtitle}
        </p>
      )}
    </div>
  );
}
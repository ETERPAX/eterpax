import { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {}

function Card({ className = "", children, ...props }: CardProps) {
  return (
    <div
      className={[
        "rounded-3xl",
        "border border-[#E7EDF4]",
        "bg-white",
        "shadow-sm",
        "transition-all duration-300",
        "hover:shadow-md",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

function Header({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["px-8 pt-8", className].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

function Body({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["px-8 py-6", className].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

function Footer({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        "flex items-center",
        "justify-between",
        "border-t border-[#E7EDF4]",
        "px-8",
        "py-6",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

Card.Header = Header;
Card.Body = Body;
Card.Footer = Footer;

export { Card };
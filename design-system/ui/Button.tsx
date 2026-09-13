import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";
import { uiStyles } from "./styles";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      leftIcon,
      rightIcon,
      className = "",
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        className={[
          uiStyles.button.base,
          uiStyles.button.variant[variant],
          uiStyles.button.size[size],
          className,
        ].join(" ")}
        {...props}
      >
        {leftIcon}

        <span>{children}</span>

        {rightIcon}
      </button>
    );
  }
);

Button.displayName = "Button";
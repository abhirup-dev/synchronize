import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn.ts";

type IconButtonVariant = "ghost" | "solid" | "accent";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  icon: LucideIcon;
  /** Used for both the accessible name and the tooltip. */
  label: string;
  variant?: IconButtonVariant;
  /** Touch-target size in px. Defaults to 44 (≥ WCAG/Apple; Material wants 48). */
  size?: number;
  /** Glyph size in px. */
  iconSize?: number;
  active?: boolean;
}

// A compact icon button sized for thumbs. Glyphs inherit the theme ink via
// `currentColor`, so it works across all data-theme palettes. Variants:
//   ghost  — transparent, for dense action rows
//   solid  — bordered chip on paper-2
//   accent — filled call-to-action (send)
export function IconButton({
  icon: Icon,
  label,
  variant = "ghost",
  size = 44,
  iconSize = 20,
  active = false,
  className,
  disabled,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      data-variant={variant}
      data-active={active ? "true" : undefined}
      className={cn(
        "icon-button inline-grid shrink-0 place-items-center rounded-[var(--radius-md)] cursor-pointer outline-none",
        "[transition:background_140ms_ease,color_140ms_ease,transform_120ms_ease,box-shadow_140ms_ease]",
        "disabled:opacity-40 disabled:cursor-default",
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon size={iconSize} strokeWidth={2} absoluteStrokeWidth aria-hidden />
    </button>
  );
}

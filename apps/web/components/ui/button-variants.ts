import { cva } from "class-variance-authority";

/**
 * Plain style-generating function, no hooks and no "use client" needed. Kept
 * in its own module so server components can call buttonVariants({...}) for
 * styling a <Link> without pulling Button's client-only code (and the
 * useTranslate() hook it calls) into the same file.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-base font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        outline: "border border-input bg-card hover:bg-secondary",
        ghost: "hover:bg-secondary",
        destructive: "bg-danger text-white hover:bg-danger/90",
        success: "bg-success text-white hover:bg-success/90",
      },
      size: {
        sm: "h-11 px-4 text-sm",
        default: "h-11 px-4",
        touch: "h-12 px-5",
        icon: "size-10",
        "icon-sm": "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

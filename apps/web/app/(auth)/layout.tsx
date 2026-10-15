export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <div className="min-h-screen bg-auth-canvas text-auth-ink [color-scheme:light]">{children}</div>;
}

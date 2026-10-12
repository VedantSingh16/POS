export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <main className="min-h-screen bg-background">{children}</main>;
}

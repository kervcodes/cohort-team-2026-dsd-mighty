import { AuthGate } from "@/auth/AuthGate";
import Sidebar from "@/components/Sidebar/sidebar";

// The signed-in app: sidebar and pages, behind AuthGate. The proxy has already sent
// signed-out visitors to /login.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    // if column width changes, sidebar width must match
    <div className="min-h-screen grid grid-cols-[2rem_1fr] sm:grid-cols-[9rem_1fr]">
      <AuthGate>
        <Sidebar />
        {children}
      </AuthGate>
    </div>
  );
}

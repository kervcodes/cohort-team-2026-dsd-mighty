import { AuthGate } from "@/auth/AuthGate";
import Sidebar from "@/components/Sidebar/sidebar";

// The signed-in app: sidebar and pages, behind AuthGate. The proxy has already sent
// signed-out visitors to /login.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    // if column width changes, sidebar width must match
    <div className="min-h-screen grid grid-cols-[2rem_minmax(0,1fr)] sm:grid-cols-[9rem_minmax(0,1fr)]">
      <AuthGate>
        <Sidebar />
        {/* Wide content (the tables) must scroll inside its card, not widen the page on a
            phone: minmax(0,1fr) stops the column growing to fit it, and this block wrapper
            makes a page's `mx-auto max-w-*` root fill the column instead of shrinking to
            its content's width, as a grid item with auto margins would. Its padding is the
            gutter between the pages and the sidebar and screen edges. */}
        <div className="px-4 pb-16 sm:px-6 lg:px-8">{children}</div>
      </AuthGate>
    </div>
  );
}

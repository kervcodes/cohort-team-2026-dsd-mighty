// content moved to /adminLayoutContent.tsx due to next pathname server issues on later params for /admin/users/[user_id]/edit
import { Suspense } from "react";
import AdminLayoutContent from "./AdminLayoutContent";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="p-8">{"Loading admin..."}</p>}>
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </Suspense>
  );
}

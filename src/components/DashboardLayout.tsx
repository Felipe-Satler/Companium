import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

interface DashboardLayoutProps {
  children: React.ReactNode;
  // Edge-to-edge pages (e.g. the chat) lift the content column above the
  // sidebar's cast neumorphic shadow so it doesn't bleed onto the left edge.
  flush?: boolean;
}

export function DashboardLayout({ children, flush = false }: DashboardLayoutProps) {
  return (
    <SidebarProvider>
        {/* flush pages (chat) get a DEFINITE viewport height so inner h-full
            resolves and the message list scrolls instead of the whole page. */}
        <div className={`flex w-full bg-ambient bg-noise ${flush ? "h-screen overflow-hidden" : "min-h-screen"}`}>
        <AppSidebar />
        <div className={`flex-1 flex flex-col min-w-0 relative ${flush ? "z-20 min-h-0" : "z-[1]"}`}>
          <header className="h-12 flex items-center border-b border-border px-4 lg:hidden">
            <SidebarTrigger />
          </header>
          <main className={`flex-1 ${flush ? "min-h-0 overflow-hidden" : "overflow-auto"}`}>{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}

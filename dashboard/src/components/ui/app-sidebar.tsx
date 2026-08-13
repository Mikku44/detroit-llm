import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader } from "./sidebar";


export function AppSidebar() {
  return (
    <Sidebar variant="inset" className="bg-[oklch(0.21_0.006_285.885)] text-[oklch(0.985_0_0)]">
      <SidebarHeader />
      <SidebarContent>
        <SidebarGroup />
        <SidebarGroup />
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  )
}
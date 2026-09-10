import * as React from "react"
import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu"

import { cn } from "@/lib/utils"

function NavigationMenu({ className, ...props }) {
  return <NavigationMenuPrimitive.Root data-slot="navigation-menu" className={cn("group/navigation-menu relative flex min-w-0 items-center justify-center", className)} {...props} />
}

function NavigationMenuList({ className, ...props }) {
  return <NavigationMenuPrimitive.List data-slot="navigation-menu-list" className={cn("group flex min-w-0 flex-1 list-none items-center justify-center gap-0 p-0", className)} {...props} />
}

function NavigationMenuItem({ className, ...props }) {
  return <NavigationMenuPrimitive.Item data-slot="navigation-menu-item" className={cn("relative", className)} {...props} />
}

function NavigationMenuLink({ className, active = false, ...props }) {
  return <NavigationMenuPrimitive.Link data-slot="navigation-menu-link" active={active} aria-current={active ? "page" : undefined} className={cn("flex h-9 w-max items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-all outline-none hover:bg-muted focus:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 data-active:bg-muted/50 [&_svg:not([class*='size-'])]:size-4", className)} {...props} />
}

export { NavigationMenu, NavigationMenuItem, NavigationMenuLink, NavigationMenuList }

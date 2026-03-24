import { createFileRoute } from "@tanstack/react-router"

import { FirewallTopology } from "@/components/Firewall"

export const Route = createFileRoute("/_layout/firewall")({
  component: FirewallPage,
  head: () => ({
    meta: [
      {
        title: "防火牆管理 - Campus Cloud",
      },
    ],
  }),
})

function FirewallPage() {
  return (
    <div className="w-full h-[calc(100vh-4rem)]">
      <FirewallTopology />
    </div>
  )
}

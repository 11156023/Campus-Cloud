import { createFileRoute } from "@tanstack/react-router"

import { ApplicationRequestPage } from "@/components/Applications/ApplicationRequestPage"

export const Route = createFileRoute("/_layout/resources-create")({
  component: ResourcesCreateRoute,
  head: () => ({
    meta: [
      {
        title: "Create Resource - Campus Cloud",
      },
    ],
  }),
})

function ResourcesCreateRoute() {
  return <ApplicationRequestPage />
}

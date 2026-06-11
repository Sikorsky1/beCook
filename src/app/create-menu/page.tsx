import { Suspense } from "react";

import CreateMenuPage from "@/components/pages/CreateMenuPage";

export default function CreateMenuRoute() {
  return (
    <Suspense fallback={null}>
      <CreateMenuPage />
    </Suspense>
  );
}

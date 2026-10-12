import { redirect } from "next/navigation";

import { createMenuImportHref } from "@/lib/navigation";

// Step 32: importing is part of Crear menú (?mode=import, contract with C6). The week is kept
// when it is a valid YYYY-Www (or the old ?isoYear=&isoWeek=); anything else is dropped.
export default async function ImportRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { week, isoYear, isoWeek } = await searchParams;
  redirect(createMenuImportHref(week, { isoYear, isoWeek }));
}

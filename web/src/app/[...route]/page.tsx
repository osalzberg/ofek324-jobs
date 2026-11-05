import { renderPage } from "@/components/pages";
import type { QueryParams } from "@/lib/data";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: {
  params: Promise<{ route: string[] }>; searchParams: Promise<QueryParams>;
}) {
  return renderPage((await params).route, await searchParams);
}

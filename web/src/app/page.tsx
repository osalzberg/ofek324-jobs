import { renderPage } from "@/components/pages";
import type { QueryParams } from "@/lib/data";
export const dynamic = "force-dynamic";
export default async function Home({ searchParams }: { searchParams: Promise<QueryParams> }) {
  return renderPage([], await searchParams);
}

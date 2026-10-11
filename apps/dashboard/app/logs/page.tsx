import { LogSearch } from '@/components/LogSearch';

export const dynamic = 'force-dynamic';

export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  return <LogSearch initial={{ service: params.service ?? '', level: params.level ?? '', q: params.q ?? '', range: params.range ?? '15m' }} />;
}

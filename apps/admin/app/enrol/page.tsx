import { EnrolForm } from './enrol-form';

export default async function EnrolPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  return <EnrolForm token={(await searchParams).token ?? ''} />;
}

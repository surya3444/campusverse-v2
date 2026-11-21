import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { DonationReceiptView } from './receipt-view';

export default async function DonationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/donations/${encodeURIComponent(id)}`);
  return <DonationReceiptView id={id} />;
}

import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../../lib/session';
import { ReceiptView } from './receipt-view';

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/fees/receipts/${encodeURIComponent(id)}`);
  return <ReceiptView id={id} />;
}

import { notFound } from 'next/navigation';
import { MobileLinkLanding } from '../../../components/MobileLinkLanding';
import { TRIP_ID } from '../../../lib/mobile-links';

export const metadata = {
  title: 'Abrir viaje',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};
export default async function RideLinkPage({
  params,
}: {
  params: Promise<{ rideId: string }>;
}) {
  const { rideId } = await params;
  if (!TRIP_ID.test(rideId)) notFound();
  return <MobileLinkLanding kind="trip" />;
}

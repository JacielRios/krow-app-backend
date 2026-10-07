import { RideDetailView } from '@/components/admin/RideDetailView';
export default async function RideDetailsPage({
  params,
}: {
  params: Promise<{ rideId: string }>;
}) {
  const { rideId } = await params;
  return <RideDetailView rideId={rideId} />;
}

import { MobileLinkLanding } from '../../../components/MobileLinkLanding';

export const metadata = {
  title: 'Continuar acceso',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};
export const dynamic = 'force-dynamic';
export default function AuthCallbackPage() {
  return <MobileLinkLanding kind="auth" />;
}

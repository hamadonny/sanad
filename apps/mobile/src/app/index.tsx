import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { LoadingView } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { keys } from '../lib/query';
import { useSettings } from '../lib/settings';

/** Entry: language → welcome slides → phone/OTP → identity → notifications → home. */
export default function Index() {
  const language = useSettings((s) => s.language);
  const seenWelcome = useSettings((s) => s.seenWelcome);
  const asked = useSettings((s) => s.askedNotifications);
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const me = useQuery({ queryKey: keys.me, queryFn: api.me, enabled: signedIn });

  if (!language) return <Redirect href="/onboarding/language" />;
  if (!seenWelcome) return <Redirect href="/onboarding/welcome" />;
  if (!signedIn) return <Redirect href="/onboarding/phone" />;
  if (!me.data) return me.isError ? <Redirect href="/(tabs)" /> : <LoadingView />;
  if (me.data.kycStatus === 'NONE' || me.data.kycStatus === 'REJECTED')
    return <Redirect href="/kyc" />;
  if (!asked) return <Redirect href="/onboarding/notifications" />;
  return <Redirect href="/(tabs)" />;
}

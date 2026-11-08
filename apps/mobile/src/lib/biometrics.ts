import * as LocalAuthentication from 'expo-local-authentication';

export async function biometricsAvailable(): Promise<boolean> {
  try {
    return (
      (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync())
    );
  } catch {
    return false;
  }
}

/**
 * Face ID / fingerprint, falling back to the device passcode. If the device has no biometrics
 * enrolled we do not block the member (the app is still protected by the phone's own lock).
 */
export async function authenticate(promptMessage: string, cancelLabel: string): Promise<boolean> {
  if (!(await biometricsAvailable())) return true;
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel,
    disableDeviceFallback: false,
  });
  return r.success;
}

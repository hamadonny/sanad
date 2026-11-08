import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function notificationPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Ask permission and register this device's push token with the API. Silently does nothing on
 * simulators or in environments without push (e.g. Expo Go on Android) — reminders still show
 * in the in-app notification list.
 */
export async function registerForPush(ask: boolean): Promise<boolean> {
  try {
    if (!Device.isDevice) return false;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Sanad',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let status = await notificationPermission();
    if (status !== 'granted' && ask)
      status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return false;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId;
    const token = projectId
      ? (await Notifications.getExpoPushTokenAsync({ projectId })).data
      : (await Notifications.getDevicePushTokenAsync()).data;
    await api.registerDevice(String(token), Platform.OS === 'ios' ? 'ios' : 'android');
    return true;
  } catch {
    return false;
  }
}

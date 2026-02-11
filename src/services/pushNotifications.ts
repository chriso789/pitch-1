// Push notification utilities for PITCH CRM
// Note: Database table 'push_subscriptions' needs to be created via migration

const VAPID_PUBLIC_KEY = 'BLBx-hf2WrL2qEa0XYeOQyQVDCR2L8wuXLn7qfKbSaqR8rXVxJq-VaOVhKjnQaMDCY-9RN-RdC_mOdTmBp8eIB8';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function checkPushSupport(): Promise<boolean> {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function getPushPermissionStatus(): Promise<NotificationPermission> {
  return Notification.permission;
}

export async function requestPushPermission(): Promise<NotificationPermission> {
  return await Notification.requestPermission();
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service workers not supported');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
    });
    
    console.log('Service Worker registered:', registration);
    return registration;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    return null;
  }
}

export interface PushSubscriptionData {
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  device_info: {
    userAgent: string;
    platform: string;
    language: string;
  };
}

export async function subscribeToPush(): Promise<{
  subscription: PushSubscription | null;
  data: PushSubscriptionData | null;
}> {
  try {
    // Check if push is supported
    if (!await checkPushSupport()) {
      console.warn('Push notifications not supported');
      return { subscription: null, data: null };
    }

    // Request permission
    const permission = await requestPushPermission();
    if (permission !== 'granted') {
      console.warn('Push notification permission denied');
      return { subscription: null, data: null };
    }

    // Register service worker
    const registration = await registerServiceWorker();
    if (!registration) {
      return { subscription: null, data: null };
    }

    // Wait for service worker to be ready
    await navigator.serviceWorker.ready;

    // Get existing subscription or create new one
    let subscription = await (registration as any).pushManager.getSubscription();
    
    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await (registration as any).pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      });
    }

    // Extract subscription data
    const subscriptionJson = subscription.toJSON();
    const subscriptionData: PushSubscriptionData = {
      endpoint: subscription.endpoint,
      p256dh_key: subscriptionJson.keys?.p256dh || '',
      auth_key: subscriptionJson.keys?.auth || '',
      device_info: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
      },
    };

    console.log('Push subscription created successfully');
    return { subscription, data: subscriptionData };

  } catch (error) {
    console.error('Failed to subscribe to push:', error);
    throw error;
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await (registration as any).pushManager.getSubscription();
    
    if (subscription) {
      await subscription.unsubscribe();
      console.log('Push subscription removed');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to unsubscribe from push:', error);
    throw error;
  }
}

export async function sendTestNotification(): Promise<void> {
  // Show a local notification for testing
  if (Notification.permission === 'granted') {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification('Test Notification', {
      body: 'Push notifications are working!',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'test-notification',
      data: {
        url: '/dashboard',
      },
    });
  }
}

// Check if browser has an active push subscription
export async function hasActiveSubscription(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await (registration as any).pushManager.getSubscription();
    return !!subscription;
  } catch (error) {
    return false;
  }
}

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.6af530d926984529aba4165abe9112fb',
  appName: 'pitch-1',
  webDir: 'dist',
  server: {
    url: 'https://6af530d9-2698-4529-aba4-165abe9112fb.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#1e40af'
  },
  android: {
    backgroundColor: '#1e40af'
  }
};

export default config;

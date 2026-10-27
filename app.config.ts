import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Neighborhood',
  slug: 'neighborhood-issue-reporter',
  extra: {
    ...config.extra,
    androidMapsConfigured: Boolean(process.env.GOOGLE_MAPS_ANDROID_API_KEY),
  },
  plugins: [
    ...(config.plugins ?? []),
    [
      'react-native-maps',
      { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '' },
    ],
  ],
});

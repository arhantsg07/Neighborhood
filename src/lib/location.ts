import * as Location from 'expo-location';
import type { Coordinates } from './reports';

export async function currentLocation(): Promise<Coordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted)
    throw new Error(
      'Location permission was denied. You can still browse reports or enter the issue’s coordinates manually.',
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                'GPS took too long. Try again outdoors, or enter the coordinates manually.',
              ),
            ),
          20000,
        );
      }),
    ]);
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

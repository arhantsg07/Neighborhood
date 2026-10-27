import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker } from 'react-native-maps';
import type { ReportMapProps } from './ReportMap';
import { colors, Empty } from './ui';

export default function ReportMap({ reports, onSelect, location }: ReportMapProps) {
  const map = useRef<MapView>(null);
  const first = location ?? reports[0] ?? { latitude: 20.5937, longitude: 78.9629 };
  useEffect(() => {
    if (reports.length > 1)
      map.current?.fitToCoordinates(reports, {
        edgePadding: { top: 45, right: 45, bottom: 45, left: 45 },
        animated: true,
      });
    else if (reports[0] || location)
      map.current?.animateToRegion(
        { ...(location ?? reports[0]), latitudeDelta: 0.015, longitudeDelta: 0.015 },
        300,
      );
  }, [reports, location]);
  if (
    Platform.OS === 'android' &&
    Constants.executionEnvironment !== 'storeClient' &&
    !Constants.expoConfig?.extra?.androidMapsConfigured
  ) {
    return (
      <Empty
        title="Map setup is needed"
        description="This Android build needs a Google Maps key. You can still use the list and open report directions. See the README for build setup."
      />
    );
  }
  return (
    <View
      style={{
        height: 340,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...first, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        showsUserLocation={Boolean(location)}
        showsMyLocationButton={Boolean(location)}
      >
        {reports.map((report) => (
          <Marker
            key={report.id}
            coordinate={report}
            title={report.category}
            description={report.description}
            pinColor={
              report.status === 'Resolved'
                ? '#24664F'
                : report.severity === 'High'
                  ? '#A53C32'
                  : '#C08A2C'
            }
            onPress={() => onSelect(report)}
          />
        ))}
      </MapView>
    </View>
  );
}

import React from 'react';
import { View } from 'react-native';
import { Empty } from './ui';
import type { Report } from '../types';
import type { Coordinates } from '../lib/reports';
export interface ReportMapProps {
  reports: Report[];
  onSelect: (report: Report) => void;
  location?: Coordinates | null;
}
export default function ReportMap(_props: ReportMapProps) {
  return (
    <View style={{ minHeight: 240 }}>
      <Empty
        title="Maps are available on mobile"
        description="Use the list here, or open the app on Android or iOS to explore report pins on a map."
      />
    </View>
  );
}

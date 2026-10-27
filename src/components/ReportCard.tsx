import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { dateLabel, distanceLabel, distanceMeters, type Coordinates } from '../lib/reports';
import type { Report } from '../types';
import { colors, StatusBadge, styles } from './ui';

export function ReportPhoto({ uri, height = 180 }: { uri: string; height?: number }) {
  const [failed, setFailed] = useState(false);
  return !uri || failed ? (
    <View
      style={{
        height,
        backgroundColor: colors.soft,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Text style={styles.muted}>Photo unavailable · refresh to retry</Text>
    </View>
  ) : (
    <Image
      accessibilityLabel="Reported issue"
      source={{ uri }}
      style={{ width: '100%', height, backgroundColor: colors.soft }}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}
export function ReportCard({
  report,
  onPress,
  location,
}: {
  report: Report;
  onPress: () => void;
  location?: Coordinates | null;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${report.category}, ${report.status}, ${report.upvotes} supporters. ${report.description}`}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <ReportPhoto key={report.image_url} uri={report.image_url} />
      <View style={{ padding: 16, gap: 10 }}>
        <View style={styles.between}>
          <Text style={styles.heading}>{report.category}</Text>
          <StatusBadge status={report.status} />
        </View>
        <Text numberOfLines={2} style={styles.body}>
          {report.description}
        </Text>
        <View style={styles.between}>
          <Text style={styles.muted}>
            {location
              ? distanceLabel(distanceMeters(report, location))
              : dateLabel(report.created_at)}
          </Text>
          <Text
            style={{
              color: report.has_upvoted ? colors.primary : colors.muted,
              fontWeight: '600',
              fontSize: 13,
            }}
          >
            ↑ {report.upvotes} supported
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

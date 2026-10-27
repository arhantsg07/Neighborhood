import React, { useMemo, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { currentLocation } from '../lib/location';
import { useApp } from '../data/AppProvider';
import { CATEGORIES, STATUSES, type Category, type ReportStatus } from '../types';
import { filterReports, errorMessage, type Coordinates } from '../lib/reports';
import { Button, Chips, Empty, Field, Notice, colors, styles } from '../components/ui';
import { ReportCard } from '../components/ReportCard';
import ReportMap from '../components/ReportMap';

export default function ExploreScreen({ onSelect }: { onSelect: (id: string) => void }) {
  const { reports, refresh, loading } = useApp();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | 'All'>('All');
  const [status, setStatus] = useState<ReportStatus | 'All'>('All');
  const [sort, setSort] = useState<'Newest' | 'Most supported' | 'Nearest'>('Newest');
  const [view, setView] = useState<'List' | 'Map'>('List');
  const [showFilters, setShowFilters] = useState(false);
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState('');
  const visible = useMemo(
    () => filterReports(reports, { query, category, status, sort, location }),
    [reports, query, category, status, sort, location],
  );
  async function locate() {
    setLocating(true);
    setNotice('');
    try {
      setLocation(await currentLocation());
      setSort('Nearest');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setLocating(false);
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={() => {
            void refresh().catch(() => {});
          }}
          tintColor={colors.primary}
        />
      }
    >
      <View style={{ gap: 6 }}>
        <Text style={styles.title}>A better neighborhood.</Text>
        <Text style={styles.muted}>Small reports. Shared progress.</Text>
      </View>
      <View
        style={[
          styles.row,
          {
            gap: 0,
            backgroundColor: colors.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.line,
            paddingVertical: 18,
          },
        ]}
      >
        {[
          ['Reported', reports.length],
          ['In progress', reports.filter((r) => r.status === 'In progress').length],
          ['Resolved', reports.filter((r) => r.status === 'Resolved').length],
        ].map(([label, count]) => (
          <View key={label} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 24, fontWeight: '700', color: colors.primary }}>{count}</Text>
            <Text style={styles.muted}>{label}</Text>
          </View>
        ))}
      </View>
      <Field
        label="Find an issue"
        placeholder="Search descriptions or categories"
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
      />
      <View style={styles.between}>
        <Text style={styles.muted}>
          {category === 'All' && status === 'All'
            ? 'All categories · all statuses'
            : `${category} · ${status}`}
        </Text>
        <Button
          title={showFilters ? 'Hide filters' : 'Filters'}
          variant="secondary"
          onPress={() => setShowFilters(!showFilters)}
        />
      </View>
      {showFilters && (
        <View style={styles.card}>
          <Chips
            label="Category"
            values={['All', ...CATEGORIES]}
            value={category}
            onChange={setCategory}
          />
          <Chips label="Status" values={['All', ...STATUSES]} value={status} onChange={setStatus} />
        </View>
      )}
      <View style={styles.between}>
        <Text style={styles.heading}>
          Community reports <Text style={styles.muted}>({visible.length})</Text>
        </Text>
        {Platform.OS !== 'web' && (
          <Chips values={['List', 'Map']} value={view} onChange={setView} />
        )}
      </View>
      <Chips
        values={location ? ['Newest', 'Most supported', 'Nearest'] : ['Newest', 'Most supported']}
        value={sort}
        onChange={setSort}
      />
      <Button
        title={location ? 'Update my location' : 'Find reports near me'}
        variant="secondary"
        busy={locating}
        onPress={() => {
          void locate();
        }}
      />
      {notice ? <Notice danger>{notice}</Notice> : null}
      {view === 'Map' && (
        <ReportMap reports={visible} onSelect={(r) => onSelect(r.id)} location={location} />
      )}
      {visible.length === 0 ? (
        <Empty
          title={loading ? 'Loading reports…' : 'No reports found'}
          description="Try a different filter, or report an issue in your neighborhood."
        />
      ) : (
        view === 'List' &&
        visible.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            location={location}
            onPress={() => onSelect(report.id)}
          />
        ))
      )}
      <Text style={[styles.muted, { textAlign: 'center' }]}>
        Pull down to refresh. For emergencies, contact local emergency services.
      </Text>
    </ScrollView>
  );
}

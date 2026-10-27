import React, { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useApp } from '../data/AppProvider';
import { STATUSES, type ReportStatus } from '../types';
import { isSupabaseConfigured } from '../lib/supabase';
import { errorMessage } from '../lib/reports';
import { Button, Chips, Empty, Notice, colors, styles } from '../components/ui';
import { ReportCard } from '../components/ReportCard';

export default function AccountScreen({ onSelect }: { onSelect: (id: string) => void }) {
  const { user, mode, reports, signOut, loading, refresh } = useApp();
  const [status, setStatus] = useState<ReportStatus | 'All'>('All');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mine = reports.filter((report) => report.user_id === user?.id);
  const visible = mine.filter((report) => status === 'All' || report.status === status);
  return (
    <ScrollView
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
        <Text style={styles.title}>Your contribution</Text>
        <Text style={styles.muted}>Keep track of the issues you have reported.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>{mode === 'demo' ? 'Demo account' : 'Your account'}</Text>
        <Text selectable style={styles.body}>
          {user?.email}
        </Text>
        <Text style={styles.muted}>
          {mode === 'demo'
            ? 'Local-only data · demo administrator'
            : user?.is_admin
              ? 'Community administrator'
              : 'Community member'}
        </Text>
        <View style={styles.row}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>{mine.length} reported</Text>
          <Text style={styles.muted}>
            · {mine.filter((r) => r.status === 'Resolved').length} resolved
          </Text>
        </View>
      </View>
      {mode === 'demo' && (
        <Notice>
          You’re using a local demo. Reports, votes, and comments are saved on this device, not
          shared. AI is not simulated.{' '}
          {isSupabaseConfigured
            ? 'Leave the demo below to sign in to the connected backend.'
            : 'Follow the README to connect Supabase and enable real accounts.'}
        </Notice>
      )}
      <View style={{ gap: 12 }}>
        <Text style={styles.heading}>My reports</Text>
        <Chips values={['All', ...STATUSES]} value={status} onChange={setStatus} />
      </View>
      {visible.length === 0 ? (
        <Empty
          title="Nothing here yet"
          description="Your submitted reports will appear here. Use the Report tab to add an issue."
        />
      ) : (
        visible.map((report) => (
          <ReportCard key={report.id} report={report} onPress={() => onSelect(report.id)} />
        ))
      )}
      <View style={styles.card}>
        <Text style={styles.heading}>How this works</Text>
        <Text style={styles.muted}>
          Submit a photo and location. Others can support the report and add useful comments.
          Administrators update its status after verifying progress.
        </Text>
        <Text style={styles.muted}>
          Community reports are not official complaints. No municipal integration or emergency
          response is provided.
        </Text>
        <Text style={styles.muted}>
          Only share information you are comfortable showing to other signed-in members. AI can make
          mistakes; always review its suggestions.
        </Text>
      </View>
      {message ? <Notice danger>{message}</Notice> : null}
      <Button
        title={mode === 'demo' ? 'Leave demo' : 'Sign out'}
        variant="secondary"
        busy={busy}
        onPress={() => {
          setBusy(true);
          setMessage('');
          void signOut()
            .catch((error) => setMessage(errorMessage(error)))
            .finally(() => setBusy(false));
        }}
      />
    </ScrollView>
  );
}

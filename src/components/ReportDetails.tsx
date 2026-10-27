import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../data/AppProvider';
import { STATUSES, type Comment } from '../types';
import { dateLabel, errorMessage } from '../lib/reports';
import { Button, Chips, Field, Notice, StatusBadge, colors, styles } from './ui';
import { ReportPhoto } from './ReportCard';

export default function ReportDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const { reports, user, mode, toggleUpvote, getComments, addComment, updateStatus } = useApp();
  const report = reports.find((r) => r.id === id);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentsError, setCommentsError] = useState('');
  const [message, setMessage] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setCommentsError('');
    void getComments(id)
      .then((data) => {
        if (active) setComments(data);
      })
      .catch((error) => {
        if (active) setCommentsError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function action(name: string, work: () => Promise<unknown>) {
    setBusy(name);
    setMessage('');
    try {
      await work();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy('');
    }
  }
  async function retryComments() {
    setLoading(true);
    setCommentsError('');
    try {
      setComments(await getComments(id));
    } catch (error) {
      setCommentsError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={[
              styles.between,
              { paddingHorizontal: 20, borderBottomWidth: 1, borderColor: colors.line },
            ]}
          >
            <Text style={styles.heading}>Report details</Text>
            <Button title="Close" variant="quiet" onPress={onClose} />
          </View>
          {!report ? (
            <View style={styles.page}>
              <Notice>This report is not available. Close this sheet and refresh the list.</Notice>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
              <View style={{ borderRadius: 16, overflow: 'hidden' }}>
                <ReportPhoto key={report.image_url} uri={report.image_url} height={250} />
              </View>
              <View style={styles.between}>
                <Text style={styles.title}>{report.category}</Text>
                <StatusBadge status={report.status} />
              </View>
              <View style={styles.row}>
                <Text style={styles.muted}>Reported {dateLabel(report.created_at)}</Text>
                <Text
                  style={{
                    color: report.severity === 'High' ? colors.danger : colors.muted,
                    fontSize: 13,
                  }}
                >
                  · {report.severity} severity
                </Text>
                {report.user_id === user?.id && (
                  <Text style={{ color: colors.primary, fontSize: 13 }}>· Your report</Text>
                )}
              </View>
              <Text selectable style={styles.body}>
                {report.description}
              </Text>
              <View style={styles.card}>
                <Text style={styles.label}>Issue location</Text>
                <Text selectable style={styles.muted}>
                  {report.latitude.toFixed(6)}, {report.longitude.toFixed(6)}
                </Text>
                <Button
                  title="Open directions in Maps ↗"
                  variant="secondary"
                  onPress={() => {
                    void action('maps', () =>
                      Linking.openURL(
                        `https://www.google.com/maps/search/?api=1&query=${report.latitude},${report.longitude}`,
                      ),
                    );
                  }}
                  disabled={!!busy}
                />
              </View>
              <Button
                title={`${report.has_upvoted ? '✓ Supported · tap to undo' : '↑ Support this report'} (${report.upvotes})`}
                variant={report.has_upvoted ? 'secondary' : 'primary'}
                busy={busy === 'vote'}
                disabled={!!busy}
                onPress={() => {
                  void action('vote', () => toggleUpvote(id));
                }}
              />
              <Text style={styles.muted}>
                Support a report to show the community that it matters. Each person gets one vote.
              </Text>
              {user?.is_admin && (
                <View style={styles.card}>
                  <Text style={styles.heading}>
                    {mode === 'demo' ? 'Demo status controls' : 'Administrator controls'}
                  </Text>
                  <Text style={styles.muted}>
                    {mode === 'demo'
                      ? 'Try the status workflow here. In live mode, only an administrator can do this.'
                      : 'Update this report after verifying progress.'}
                  </Text>
                  <Chips
                    values={STATUSES}
                    value={report.status}
                    onChange={(status) => {
                      if (!busy && status !== report.status)
                        void action('status', () => updateStatus(id, status));
                    }}
                  />
                  {busy === 'status' && <ActivityIndicator color={colors.primary} />}
                </View>
              )}
              <View style={styles.divider} />
              <View style={styles.between}>
                <Text style={styles.heading}>Community discussion ({comments.length})</Text>
                <Button
                  title="Refresh"
                  variant="quiet"
                  disabled={loading}
                  onPress={() => {
                    void retryComments();
                  }}
                />
              </View>
              {loading ? (
                <ActivityIndicator color={colors.primary} />
              ) : commentsError ? (
                <Notice danger>{commentsError}</Notice>
              ) : comments.length === 0 ? (
                <Text style={styles.muted}>
                  No comments yet. Add helpful context or a progress update.
                </Text>
              ) : (
                comments.map((comment) => (
                  <View key={comment.id} style={styles.card}>
                    <View style={styles.between}>
                      <Text style={styles.label}>
                        {comment.user_id === user?.id
                          ? 'You'
                          : comment.user_id === report.user_id
                            ? 'Report author'
                            : 'Community member'}
                      </Text>
                      <Text style={styles.muted}>{dateLabel(comment.created_at)}</Text>
                    </View>
                    <Text selectable style={styles.body}>
                      {comment.body}
                    </Text>
                  </View>
                ))
              )}
              <Field
                label="Add a comment"
                placeholder="Keep it constructive and avoid personal information."
                value={body}
                onChangeText={setBody}
                multiline
                maxLength={1000}
                editable={busy !== 'comment'}
                hint={`${body.length}/1,000 characters`}
              />
              {message ? <Notice danger>{message}</Notice> : null}
              <Button
                title="Post comment"
                busy={busy === 'comment'}
                disabled={!!busy || !body.trim()}
                onPress={() => {
                  void action('comment', async () => {
                    const comment = await addComment(id, body);
                    setComments((previous) => [...previous, comment]);
                    setBody('');
                  });
                }}
              />
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

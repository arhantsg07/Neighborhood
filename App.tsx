import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useApp } from './src/data/AppProvider';
import { Button, colors, styles } from './src/components/ui';
import ReportDetails from './src/components/ReportDetails';
import AuthScreen from './src/screens/AuthScreen';
import ExploreScreen from './src/screens/ExploreScreen';
import NewReportScreen from './src/screens/NewReportScreen';
import AccountScreen from './src/screens/AccountScreen';

const TABS = [
  { name: 'Explore', icon: '◎' },
  { name: 'Report', icon: '+' },
  { name: 'Account', icon: '○' },
] as const;
type Tab = (typeof TABS)[number]['name'];
function Shell() {
  const { ready, user, mode, error, clearError, refresh } = useApp();
  const [tab, setTab] = useState<Tab>('Explore');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setSelected(null);
    setTab('Explore');
  }, [user?.id]);
  if (!ready)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
        }}
      >
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>Opening Neighborhood…</Text>
      </View>
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={[
          styles.between,
          {
            height: 56,
            paddingHorizontal: 20,
            backgroundColor: colors.surface,
            borderBottomWidth: 1,
            borderColor: colors.line,
          },
        ]}
      >
        <Text
          style={{ fontSize: 21, fontWeight: '700', color: colors.primary, letterSpacing: -0.6 }}
        >
          neighborhood<Text style={{ color: '#A5B8AA' }}>.</Text>
        </Text>
        <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '600', letterSpacing: 1 }}>
          {mode === 'demo' ? 'LOCAL DEMO' : 'COMMUNITY'}
        </Text>
      </View>
      {error && (
        <View
          accessibilityRole="alert"
          style={{ backgroundColor: '#FCECE8', paddingHorizontal: 16, paddingVertical: 8, gap: 4 }}
        >
          <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text>
          <View style={styles.row}>
            <Button title="Dismiss" variant="quiet" onPress={clearError} />
            {user && (
              <Button
                title="Retry refresh"
                variant="quiet"
                onPress={() => {
                  void refresh().catch(() => {});
                }}
              />
            )}
          </View>
        </View>
      )}
      {!user ? (
        <AuthScreen />
      ) : (
        <>
          <View style={{ flex: 1 }}>
            <View
              style={[StyleSheet.absoluteFill, { display: tab === 'Explore' ? 'flex' : 'none' }]}
            >
              <ExploreScreen onSelect={setSelected} />
            </View>
            <View
              style={[StyleSheet.absoluteFill, { display: tab === 'Report' ? 'flex' : 'none' }]}
            >
              <NewReportScreen
                onSelect={setSelected}
                onCreated={(id) => {
                  setTab('Explore');
                  setSelected(id);
                }}
              />
            </View>
            <View
              style={[StyleSheet.absoluteFill, { display: tab === 'Account' ? 'flex' : 'none' }]}
            >
              <AccountScreen onSelect={setSelected} />
            </View>
          </View>
          <View
            accessibilityRole="tablist"
            style={{
              flexDirection: 'row',
              backgroundColor: colors.surface,
              borderTopWidth: 1,
              borderColor: colors.line,
              paddingTop: 5,
              paddingBottom: 3,
            }}
          >
            {TABS.map((item) => (
              <Pressable
                key={item.name}
                accessibilityRole="tab"
                accessibilityLabel={item.name}
                accessibilityState={{ selected: tab === item.name }}
                onPress={() => setTab(item.name)}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 8, gap: 3 }}
              >
                <View
                  style={{
                    width: 52,
                    height: 28,
                    borderRadius: 16,
                    backgroundColor: tab === item.name ? colors.soft : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: tab === item.name ? colors.primary : colors.muted,
                      fontSize: 25,
                      lineHeight: 28,
                      fontWeight: '500',
                    }}
                  >
                    {item.icon}
                  </Text>
                </View>
                <Text
                  style={{
                    color: tab === item.name ? colors.primary : colors.muted,
                    fontSize: 11,
                    fontWeight: tab === item.name ? '700' : '400',
                  }}
                >
                  {item.name}
                </Text>
              </Pressable>
            ))}
          </View>
          {selected && (
            <ReportDetails key={selected} id={selected} onClose={() => setSelected(null)} />
          )}
        </>
      )}
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}

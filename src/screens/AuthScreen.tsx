import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useApp } from '../data/AppProvider';
import { isSupabaseConfigured } from '../lib/supabase';
import { errorMessage } from '../lib/reports';
import { Button, Field, Notice, colors, styles } from '../components/ui';

export default function AuthScreen() {
  const { signIn, signUp, enterDemo } = useApp();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [info, setInfo] = useState('');
  async function submit() {
    setMessage('');
    setInfo('');
    if (signup && password.length < 8) {
      setMessage('Use a password with at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      if (signup) {
        const result = await signUp(email, password);
        if (result) setInfo(result);
      } else await signIn(email, password);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.page,
          { flexGrow: 1, justifyContent: 'center', maxWidth: 480, paddingVertical: 48 },
        ]}
      >
        <View
          style={{
            backgroundColor: colors.primary,
            width: 58,
            height: 58,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 32 }}>n.</Text>
        </View>
        <View style={{ gap: 10 }}>
          <Text style={[styles.title, { fontSize: 36 }]}>Neighborhood</Text>
          <Text style={styles.body}>
            Notice it. Report it.{'\n'}Make your community a little better.
          </Text>
        </View>
        {isSupabaseConfigured ? (
          <View style={styles.card}>
            <Text style={styles.heading}>{signup ? 'Create an account' : 'Welcome back'}</Text>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              editable={!busy}
              placeholder="you@example.com"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={signup ? 'new-password' : 'current-password'}
              editable={!busy}
              placeholder={signup ? 'At least 8 characters' : 'Your password'}
              onSubmitEditing={() => {
                if (!busy) void submit();
              }}
            />
            {message ? <Notice danger>{message}</Notice> : null}
            {info ? <Notice>{info}</Notice> : null}
            <Button
              title={signup ? 'Create account' : 'Sign in'}
              busy={busy}
              onPress={() => {
                void submit();
              }}
            />
            <Button
              title={signup ? 'Already registered? Sign in' : 'New here? Create an account'}
              variant="quiet"
              disabled={busy}
              onPress={() => {
                setSignup(!signup);
                setMessage('');
                setInfo('');
              }}
            />
          </View>
        ) : (
          <Notice>
            No backend is connected yet. Demo mode lets you try the complete local reporting
            workflow without creating an account.
          </Notice>
        )}
        {!isSupabaseConfigured && message ? <Notice danger>{message}</Notice> : null}
        <Button
          title="Explore the local demo"
          variant="secondary"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void enterDemo()
              .catch((error) => setMessage(errorMessage(error)))
              .finally(() => setBusy(false));
          }}
        />
        <Text style={styles.muted}>
          Demo reports stay on this device. A connected account shares reports with the community.
          This app does not send reports to local authorities.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

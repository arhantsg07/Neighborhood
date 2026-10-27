import React, { useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { currentLocation } from '../lib/location';
import { useApp } from '../data/AppProvider';
import { CATEGORIES, SEVERITIES, type Category, type ReportDraft, type Severity } from '../types';
import { errorMessage, nearbyDuplicates, validateReport } from '../lib/reports';
import { Button, Chips, Field, Notice, colors, styles } from '../components/ui';

export default function NewReportScreen({
  onCreated,
  onSelect,
}: {
  onCreated: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const { reports, mode, createReport, analyzeImage } = useApp();
  const [photo, setPhoto] = useState('');
  const [category, setCategory] = useState<Category>('Pothole');
  const [severity, setSeverity] = useState<Severity>('Medium');
  const [description, setDescription] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');
  const [aiReviewed, setAiReviewed] = useState(false);
  const hasLocation =
    latitude.trim() !== '' &&
    longitude.trim() !== '' &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude)) &&
    Math.abs(Number(latitude)) <= 90 &&
    Math.abs(Number(longitude)) <= 180;
  const duplicates = useMemo(
    () =>
      hasLocation
        ? nearbyDuplicates(reports, category, {
            latitude: Number(latitude),
            longitude: Number(longitude),
          })
        : [],
    [reports, category, latitude, longitude, hasLocation],
  );
  async function locate() {
    const result = await currentLocation();
    setLatitude(result.latitude.toFixed(6));
    setLongitude(result.longitude.toFixed(6));
  }
  async function pickPhoto(camera: boolean) {
    setBusy('photo');
    setMessage('');
    setSuccess('');
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          `${camera ? 'Camera' : 'Photo library'} permission was denied. Enable it in your device settings, or use the other photo option.`,
        );
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
        exif: false,
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      const image = await ImageManipulator.manipulateAsync(
        asset.uri,
        [
          {
            resize:
              asset.width >= asset.height
                ? { width: Math.min(asset.width, 1440) }
                : { height: Math.min(asset.height, 1440) },
          },
        ],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
      );
      setPhoto(image.uri);
      setAiReviewed(false);
      if (!hasLocation) {
        try {
          await locate();
        } catch (error) {
          setMessage(`Photo added. ${errorMessage(error)}`);
        }
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy('');
    }
  }
  async function runAI() {
    setBusy('ai');
    setMessage('');
    setSuccess('');
    try {
      const result = await analyzeImage(photo);
      setCategory(result.category);
      setSeverity(result.severity);
      setDescription(result.description);
      setAiReviewed(true);
      setSuccess(
        'Suggestions added. Check the category, severity, and description before submitting.',
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy('');
    }
  }
  async function submit() {
    setMessage('');
    setSuccess('');
    if (!hasLocation) {
      setMessage('Use GPS or enter valid latitude and longitude for this issue.');
      return;
    }
    const draft: ReportDraft = {
      image_uri: photo,
      category,
      severity,
      description,
      latitude: Number(latitude),
      longitude: Number(longitude),
    };
    const invalid = validateReport(draft);
    if (invalid) {
      setMessage(invalid);
      return;
    }
    if (!consent) {
      setMessage('Confirm you are happy to share this photo and location with the community.');
      return;
    }
    setBusy('submit');
    try {
      const report = await createReport(draft);
      setPhoto('');
      setDescription('');
      setCategory('Pothole');
      setSeverity('Medium');
      setLatitude('');
      setLongitude('');
      setConsent(false);
      setAiReviewed(false);
      setSuccess('Your report was submitted. Thank you for helping your neighborhood.');
      onCreated(report.id);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy('');
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <View style={{ gap: 6 }}>
          <Text style={styles.title}>Report an issue</Text>
          <Text style={styles.muted}>A photo, a location, and a little context.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>1. Add a photo</Text>
          <Text style={styles.muted}>
            Focus on the issue. Avoid faces, license plates, and private information.
          </Text>
          {photo ? (
            <Image
              source={{ uri: photo }}
              accessibilityLabel="Selected issue photo"
              style={{ height: 220, width: '100%', borderRadius: 10 }}
            />
          ) : (
            <View
              style={{
                height: 130,
                borderRadius: 10,
                borderStyle: 'dashed',
                borderWidth: 1,
                borderColor: '#A5B8AA',
                backgroundColor: colors.background,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={styles.muted}>Show what needs attention</Text>
            </View>
          )}
          <View style={styles.row}>
            <Button
              title="Take photo"
              onPress={() => {
                void pickPhoto(true);
              }}
              disabled={!!busy}
              variant="secondary"
              style={{ flex: 1 }}
            />
            <Button
              title="Choose photo"
              onPress={() => {
                void pickPhoto(false);
              }}
              disabled={!!busy}
              variant="secondary"
              style={{ flex: 1 }}
            />
          </View>
          {busy === 'photo' && (
            <Text style={styles.muted}>Preparing photo and finding location…</Text>
          )}
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>2. Describe the issue</Text>
          <Text style={styles.muted}>
            {mode === 'demo'
              ? 'AI requires a connected backend. In demo mode, fill in the details yourself.'
              : 'Optional: send this photo to our AI provider to suggest details. You stay in control of what is submitted.'}
          </Text>
          <Button
            title={aiReviewed ? 'Generate suggestions again' : 'Suggest details with AI'}
            variant="secondary"
            disabled={!photo || !!busy || mode === 'demo'}
            busy={busy === 'ai'}
            onPress={() => {
              void runAI();
            }}
          />
          <Chips
            label="Category"
            values={CATEGORIES}
            value={category}
            onChange={(value) => {
              if (!busy) setCategory(value);
            }}
          />
          <Chips
            label="Severity · your assessment, not emergency triage"
            values={SEVERITIES}
            value={severity}
            onChange={(value) => {
              if (!busy) setSeverity(value);
            }}
          />
          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            editable={!busy}
            multiline
            maxLength={2000}
            placeholder="What is wrong, where is it, and how does it affect people?"
            hint={`${description.length}/2,000 · minimum 10 characters`}
          />
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>3. Confirm the location</Text>
          <Text style={styles.muted}>
            GPS uses your current location. If the issue is elsewhere, change the coordinates before
            submitting.
          </Text>
          <Button
            title={hasLocation ? 'Update with my GPS location' : 'Use my GPS location'}
            busy={busy === 'location'}
            disabled={!!busy}
            variant="secondary"
            onPress={() => {
              setBusy('location');
              setMessage('');
              void locate()
                .catch((error) => setMessage(errorMessage(error)))
                .finally(() => setBusy(''));
            }}
          />
          <View style={[styles.row, { alignItems: 'flex-start' }]}>
            <View style={{ flex: 1, minWidth: 120 }}>
              <Field
                label="Latitude"
                value={latitude}
                onChangeText={setLatitude}
                editable={!busy}
                keyboardType="numbers-and-punctuation"
                placeholder="e.g. 12.971600"
              />
            </View>
            <View style={{ flex: 1, minWidth: 120 }}>
              <Field
                label="Longitude"
                value={longitude}
                onChangeText={setLongitude}
                editable={!busy}
                keyboardType="numbers-and-punctuation"
                placeholder="e.g. 77.594600"
              />
            </View>
          </View>
          {hasLocation && (
            <Text style={{ color: colors.primary, fontSize: 13 }}>✓ Location is ready</Text>
          )}
        </View>
        {duplicates.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.heading}>This may already be reported</Text>
            <Text style={styles.muted}>
              Found {duplicates.length} open {category.toLowerCase()} report(s) within 100 m.
              Consider supporting an existing report instead.
            </Text>
            {duplicates.slice(0, 3).map((report) => (
              <Button
                key={report.id}
                title={`${report.description.slice(0, 65)} →`}
                variant="secondary"
                onPress={() => onSelect(report.id)}
              />
            ))}
          </View>
        )}
        <View style={[styles.row, { flexWrap: 'nowrap', alignItems: 'flex-start' }]}>
          <Switch
            accessibilityLabel="Consent to share this photo and exact issue location"
            value={consent}
            onValueChange={setConsent}
            disabled={!!busy}
            trackColor={{ true: colors.primary }}
          />
          <Text style={[styles.muted, { flex: 1 }]}>
            I confirm the report is accurate and agree to share this photo and exact issue location
            with signed-in community members.
          </Text>
        </View>
        {message ? <Notice danger>{message}</Notice> : null}
        {success ? <Notice>{success}</Notice> : null}
        <Button
          title="Submit report"
          busy={busy === 'submit'}
          disabled={!!busy}
          onPress={() => {
            void submit();
          }}
        />
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          This is a community tracker, not an official municipal service. For urgent danger, contact
          emergency services.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

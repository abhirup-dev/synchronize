import React from 'react';
import { useCssElement } from 'react-native-css';
import { Link as RouterLink } from 'expo-router';
import {
  View as RNView,
  Text as RNText,
  Pressable as RNPressable,
  ScrollView as RNScrollView,
  TextInput as RNTextInput,
} from 'react-native';
import { SafeAreaView as RNSafeAreaView } from 'react-native-safe-area-context';

// `as any` casts: typedRoutes href / ScrollView prop unions blow TS2590 inside
// useCssElement's generic; the runtime mapping is unaffected.
export const Link = (props: React.ComponentProps<typeof RouterLink> & { className?: string }) =>
  useCssElement(RouterLink as any, props as any, { className: 'style' });

export type ViewProps = React.ComponentProps<typeof RNView> & { className?: string };
export const View = (props: ViewProps) => useCssElement(RNView as any, props as any, { className: 'style' });
View.displayName = 'CSS(View)';

export const Text = (props: React.ComponentProps<typeof RNText> & { className?: string }) =>
  useCssElement(RNText as any, props as any, { className: 'style' });
Text.displayName = 'CSS(Text)';

export const ScrollView = (
  props: React.ComponentProps<typeof RNScrollView> & {
    className?: string;
    contentContainerClassName?: string;
  },
) =>
  useCssElement(RNScrollView as any, props as any, {
    className: 'style',
    contentContainerClassName: 'contentContainerStyle',
  });
ScrollView.displayName = 'CSS(ScrollView)';

export const Pressable = (
  props: React.ComponentProps<typeof RNPressable> & { className?: string },
) => useCssElement(RNPressable as any, props as any, { className: 'style' });
Pressable.displayName = 'CSS(Pressable)';

export const TextInput = (
  props: React.ComponentProps<typeof RNTextInput> & { className?: string },
) => useCssElement(RNTextInput as any, props as any, { className: 'style' });
TextInput.displayName = 'CSS(TextInput)';

export const SafeAreaView = (
  props: React.ComponentProps<typeof RNSafeAreaView> & { className?: string },
) => useCssElement(RNSafeAreaView as any, props as any, { className: 'style' });
SafeAreaView.displayName = 'CSS(SafeAreaView)';


import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet, TextInputProps, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { Colors, Typography, Spacing, Radius } from '@/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: string;
  rightIcon?: string;
  onRightIconPress?: () => void;
}

export function Input({ label, error, hint, leftIcon, rightIcon, onRightIconPress, secureTextEntry, style, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);
  const [secure, setSecure] = useState(secureTextEntry ?? false);

  const isPassword = secureTextEntry === true;

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.container, focused && styles.focused, !!error && styles.errored]}>
        {leftIcon ? <Icon name={leftIcon} size={20} color={Colors.textMuted} style={styles.leftIcon} /> : null}
        <TextInput
          style={[styles.input, leftIcon ? styles.inputWithLeft : undefined, style]}
          placeholderTextColor={Colors.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          secureTextEntry={secure}
          autoCorrect={false}
          {...rest}
        />
        {isPassword ? (
          <TouchableOpacity onPress={() => setSecure(!secure)} style={styles.rightIcon}>
            <Icon name={secure ? 'visibility-off' : 'visibility'} size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : rightIcon ? (
          <TouchableOpacity onPress={onRightIconPress} style={styles.rightIcon}>
            <Icon name={rightIcon} size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.base },
  label: { ...Typography.label, color: Colors.text, marginBottom: Spacing.xs },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    minHeight: 48,
  },
  focused: { borderColor: Colors.primary },
  errored: { borderColor: Colors.error },
  input: { flex: 1, ...Typography.body, color: Colors.text, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  inputWithLeft: { paddingLeft: 0 },
  leftIcon: { marginLeft: Spacing.md },
  rightIcon: { paddingHorizontal: Spacing.md },
  error: { ...Typography.caption, color: Colors.error, marginTop: Spacing.xs },
  hint: { ...Typography.caption, color: Colors.textMuted, marginTop: Spacing.xs },
});

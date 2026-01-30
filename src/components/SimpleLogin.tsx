/**
 * Simple Login Component for Testing
 * 
 * Tento komponent umožňuje jednoduché prihlásenie pre testovacie účely.
 */

import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert } from 'react-native';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';

export function SimpleLogin({ onLogin }: { onLogin: (userId: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Chyba', 'Zadaj email a heslo');
      return;
    }

    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      onLogin(userCredential.user.uid);
      Alert.alert('Úspech', 'Prihlásenie úspešné!');
    } catch (error: any) {
      // Ak užívateľ neexistuje, skús vytvoriť nového
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        try {
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          onLogin(userCredential.user.uid);
          Alert.alert('Úspech', 'Nový užívateľ vytvorený a prihlásený!');
        } catch (createError: any) {
          Alert.alert('Chyba', createError.message || 'Nepodarilo sa prihlásiť');
        }
      } else {
        Alert.alert('Chyba', error.message || 'Nepodarilo sa prihlásiť');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔐 Prihlásenie</Text>
      <Text style={styles.subtitle}>Pre testovanie Test 2 a Test 3</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      
      <TextInput
        style={styles.input}
        placeholder="Heslo"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      
      <Button
        title={loading ? "Prihlasujem..." : "Prihlásiť sa"}
        onPress={handleLogin}
        disabled={loading}
      />
      
      <Text style={styles.note}>
        Poznámka: Ak užívateľ neexistuje, vytvorí sa automaticky.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
  },
  note: {
    fontSize: 12,
    color: '#999',
    marginTop: 16,
    textAlign: 'center',
  },
});

/**
 * Sanity Tests Component
 * 
 * Tento komponent obsahuje testy pre overenie funkčnosti:
 * 1. Čítanie template (phases + tasks)
 * 2. Vytvorenie projektu zo šablóny
 * 3. Zmena statusu úlohy
 * 
 * Použitie: Pridaj tento komponent do nejakej Debug obrazovky alebo ako samostatnú obrazovku
 */

import React, { useState, useEffect } from 'react';
import { View, Text, Button, StyleSheet, ScrollView, Alert } from 'react-native';
import { getTemplatePhases, getTemplateTasks } from '../services/templateService';
import { instantiateTemplate } from '../services/projectFactory';
import { updateTaskStatus } from '../services/taskService';
import { getProjectOverview } from '../services/projectOverviewService';
import { auth } from '../firebase';
import { SimpleLogin } from './SimpleLogin';
import * as debugProjects from '../services/debugProjects';

export function SanityTests() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    // Check if user is already logged in
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        setUserId(user.uid);
        setShowLogin(false);
        setResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ✅ Užívateľ prihlásený: ${user.email}`]);
      } else {
        setUserId(null);
      }
    });

    return unsubscribe;
  }, []);

  const addResult = (message: string) => {
    setResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    console.log(message);
  };

  // Test 1: Čítanie template
  const testReadTemplate = async () => {
    setLoading(true);
    addResult('🧪 Test 1: Čítanie template...');
    
    try {
      const templateId = 'eu-construction-v1';
      
      const [phases, tasks] = await Promise.all([
        getTemplatePhases(templateId),
        getTemplateTasks(templateId),
      ]);
      
      addResult(`✅ Template načítaný: ${phases.length} fáz, ${tasks.length} úloh`);
      
      if (phases.length === 0) {
        addResult('⚠️  Varovanie: Žiadne fázy v template!');
      }
      if (tasks.length === 0) {
        addResult('⚠️  Varovanie: Žiadne úlohy v template!');
      }
      
      Alert.alert('Test 1: Úspech', `Načítané: ${phases.length} fáz, ${tasks.length} úloh`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addResult(`❌ Chyba: ${errorMsg}`);
      Alert.alert('Test 1: Chyba', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Test 2: Vytvorenie projektu zo šablóny
  const testCreateProject = async () => {
    setLoading(true);
    addResult('🧪 Test 2: Vytvorenie projektu zo šablóny...');
    
    try {
      if (!userId) {
        setShowLogin(true);
        throw new Error('Užívateľ nie je prihlásený! Klikni na "Prihlásiť sa" pre pokračovanie.');
      }
      
      const projectId = await instantiateTemplate({
        ownerId: userId,
        projectType: 'BUILD',
        templateId: 'eu-construction-v1',
        name: `Test Project ${new Date().toISOString()}`,
      });
      
      addResult(`✅ Projekt vytvorený: ${projectId}`);
      
      // Overiť že sa vytvorili phases a tasks
      const overview = await getProjectOverview(projectId);
      addResult(`✅ Phases: ${overview.phases.length}, Tasks: ${overview.tasks.length}`);
      
      Alert.alert(
        'Test 2: Úspech',
        `Projekt vytvorený!\nID: ${projectId}\nPhases: ${overview.phases.length}\nTasks: ${overview.tasks.length}\n\nSkontroluj v Firebase Console: projects/${projectId}/phases a projects/${projectId}/tasks`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addResult(`❌ Chyba: ${errorMsg}`);
      Alert.alert('Test 2: Chyba', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Test 3: Zmena statusu úlohy
  const testTaskStatusChange = async () => {
    setLoading(true);
    addResult('🧪 Test 3: Zmena statusu úlohy...');
    
    try {
      if (!userId) {
        setShowLogin(true);
        throw new Error('Užívateľ nie je prihlásený! Klikni na "Prihlásiť sa" pre pokračovanie.');
      }
      
      // Najprv vytvor projekt
      addResult('Vytváram test projekt...');
      const projectId = await instantiateTemplate({
        ownerId: userId,
        projectType: 'BUILD',
        templateId: 'eu-construction-v1',
        name: `Status Test ${new Date().toISOString()}`,
      });
      
      // Načítaj úlohy
      const overview = await getProjectOverview(projectId);
      if (overview.tasks.length === 0) {
        throw new Error('Žiadne úlohy v projekte!');
      }
      
      const firstTask = overview.tasks[0];
      addResult(`Používam úlohu: ${firstTask.id} (${firstTask.title})`);
      
      // Test: OPEN → DONE
      addResult('Test: OPEN → DONE');
      await updateTaskStatus(projectId, firstTask.id, 'DONE');
      
      const afterDone = await getProjectOverview(projectId);
      const doneTask = afterDone.tasks.find(t => t.id === firstTask.id);
      if (doneTask?.status !== 'DONE') {
        throw new Error('Status sa nezmenil na DONE!');
      }
      if (!doneTask?.doneAt) {
        throw new Error('doneAt sa nenastavil!');
      }
      addResult(`✅ Status: DONE, doneAt: ${doneTask.doneAt ? 'nastavený' : 'CHYBA'}`);
      
      // Test: DONE → OPEN
      addResult('Test: DONE → OPEN');
      await updateTaskStatus(projectId, firstTask.id, 'OPEN');
      
      const afterOpen = await getProjectOverview(projectId);
      const openTask = afterOpen.tasks.find(t => t.id === firstTask.id);
      if (openTask?.status !== 'OPEN') {
        throw new Error('Status sa nezmenil na OPEN!');
      }
      if (openTask?.doneAt !== null) {
        throw new Error('doneAt sa nevymazal!');
      }
      addResult(`✅ Status: OPEN, doneAt: ${openTask.doneAt === null ? 'vymazaný' : 'CHYBA'}`);
      
      Alert.alert(
        'Test 3: Úspech',
        `Status change test prešiel!\n\nProjekt ID: ${projectId}\nTask ID: ${firstTask.id}\n\nSkontroluj v Firebase Console že doneAt sa správne nastavuje/vymazáva.`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addResult(`❌ Chyba: ${errorMsg}`);
      Alert.alert('Test 3: Chyba', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Test 4: Nájdenie projektu z 28.01.2026
  const testFindProject = async () => {
    setLoading(true);
    addResult('🔍 Test 4: Hľadanie projektu z 28.01.2026 okolo 22:00...');
    
    try {
      // Najprv skontroluj aktuálneho užívateľa
      await debugProjects.debugCheckUserProjects();
      addResult('✅ Skontrolované projekty - pozri konzolu pre detaily');
      
      // Hľadaj projekt z 28.01.2026 okolo 22:00
      const targetDate = new Date('2026-01-28T22:00:00');
      const foundProjects = await debugProjects.debugFindProjectByTime(targetDate, 60); // ±60 minút tolerance
      
      if (foundProjects.length === 0) {
        addResult('⚠️  Nenašiel sa žiadny projekt z tohto času');
        addResult('💡 Skúsim nájsť všetky projekty...');
        const allProjects = await debugProjects.debugListAllProjects();
        addResult(`📊 Celkom projektov v databáze: ${allProjects.length}`);
        Alert.alert(
          'Test 4: Výsledok',
          `Nenašiel sa projekt z 28.01.2026 okolo 22:00.\n\nCelkom projektov v databáze: ${allProjects.length}\n\nPozri konzolu pre zoznam všetkých projektov.`
        );
      } else {
        foundProjects.forEach((p, i) => {
          addResult(`✅ Nájdený projekt ${i + 1}:`);
          addResult(`   - Názov: ${p.name}`);
          addResult(`   - ID: ${p.id}`);
          addResult(`   - ownerId: ${p.ownerId}`);
          addResult(`   - createdAt: ${p.createdAt}`);
        });
        Alert.alert(
          'Test 4: Nájdené projekty',
          `Našiel som ${foundProjects.length} projekt(ov) z tohto času:\n\n${foundProjects.map(p => `• ${p.name}\n  ID: ${p.id}\n  ownerId: ${p.ownerId}`).join('\n\n')}\n\nPozri konzolu pre viac detailov.`
        );
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addResult(`❌ Chyba: ${errorMsg}`);
      Alert.alert('Test 4: Chyba', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const clearResults = () => {
    setResults([]);
  };

  if (showLogin) {
    return (
      <ScrollView style={styles.container}>
        <Text style={styles.title}>🧪 Sanity Tests</Text>
        <Text style={styles.subtitle}>Overenie funkčnosti Firebase služieb</Text>
        <SimpleLogin onLogin={(uid) => {
          setUserId(uid);
          setShowLogin(false);
        }} />
        <Button
          title="Zrušiť"
          onPress={() => setShowLogin(false)}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>🧪 Sanity Tests</Text>
      <Text style={styles.subtitle}>Overenie funkčnosti Firebase služieb</Text>
      
      {userId && (
        <Text style={styles.loggedIn}>✅ Prihlásený</Text>
      )}
      
      {!userId && (
        <View style={styles.loginPrompt}>
          <Text style={styles.loginText}>
            Pre Test 2 a Test 3 musíš byť prihlásený.
          </Text>
          <Button
            title="Prihlásiť sa"
            onPress={() => setShowLogin(true)}
          />
        </View>
      )}
      
      <View style={styles.buttonContainer}>
        <Button
          title="Test 1: Čítanie Template"
          onPress={testReadTemplate}
          disabled={loading}
        />
        
        <View style={styles.spacer} />
        
        <Button
          title="Test 2: Vytvorenie Projektu"
          onPress={testCreateProject}
          disabled={loading}
        />
        
        <View style={styles.spacer} />
        
        <Button
          title="Test 3: Zmena Statusu"
          onPress={testTaskStatusChange}
          disabled={loading}
        />
        
        <View style={styles.spacer} />
        
        <Button
          title="Test 4: Nájsť Projekt z 28.01.2026"
          onPress={testFindProject}
          disabled={loading}
          color="#FF9800"
        />
        
        <View style={styles.spacer} />
        
        <Button
          title="Vymazať výsledky"
          onPress={clearResults}
          disabled={loading}
        />
      </View>
      
      {loading && (
        <Text style={styles.loading}>⏳ Načítavam...</Text>
      )}
      
      <View style={styles.results}>
        <Text style={styles.resultsTitle}>Výsledky:</Text>
        {results.map((result, index) => (
          <Text key={index} style={styles.resultItem}>
            {result}
          </Text>
        ))}
        {results.length === 0 && (
          <Text style={styles.noResults}>Žiadne výsledky. Spusti testy.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
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
  buttonContainer: {
    marginBottom: 24,
  },
  spacer: {
    height: 12,
  },
  loading: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
    textAlign: 'center',
  },
  results: {
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  resultsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  resultItem: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  noResults: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  loggedIn: {
    fontSize: 14,
    color: '#4CAF50',
    marginBottom: 16,
    fontWeight: 'bold',
  },
  loginPrompt: {
    backgroundColor: '#fff3cd',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  loginText: {
    fontSize: 14,
    color: '#856404',
    marginBottom: 8,
  },
});

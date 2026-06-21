import React, { useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Alert, RefreshControl, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../src/store';
import { colors, radius, priorityColor } from '../../src/theme';
import { fmtDue } from '../../src/format';
import { Empty } from '../../src/components/ui';
import { Loading, ErrorBanner } from '../../src/components/state';
import type { Project } from '../../src/types';

const PALETTE = ['#6d6ffb', '#9b6dfb', '#f06292', '#ef5350', '#ffa726', '#ffd54f', '#66bb6a', '#26c6da', '#42a5f5', '#8d6e63'];

export default function Projects() {
  const { state, loading, refreshing, error, refresh, addProject } = useStore();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const projects = useMemo(() => {
    const list = [...(state?.projects ?? [])].filter((p) => p.status !== 'archived');
    return list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [state]);

  function counts(p: Project) {
    const tasks = (state?.tasks ?? []).filter((t) => t.projectIds.includes(p.id));
    const done = tasks.filter((t) => t.status === 'done').length;
    return { total: tasks.length, done };
  }

  function newProject() {
    const color = PALETTE[projects.length % PALETTE.length];
    if (Platform.OS === 'ios') {
      Alert.prompt('New project', 'Name', (name) => {
        if (name?.trim()) addProject({ name: name.trim(), color });
      });
    } else {
      // Android has no Alert.prompt; create a placeholder the user can rename in the web app.
      Alert.alert('New project', 'Create an untitled project?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Create', onPress: () => addProject({ name: 'Untitled project', color }) },
      ]);
    }
  }

  if (loading && !state) return <Loading />;

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={projects}
      keyExtractor={(p) => p.id}
      ItemSeparatorComponent={() => <View style={{ height: 11 }} />}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 14 }}>
          {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}
          <Pressable style={styles.newBtn} onPress={newProject}>
            <Text style={styles.newBtnText}>＋ New project</Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={<Empty text="No projects yet." />}
      renderItem={({ item }) => {
        const c = counts(item);
        const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
        return (
          <Pressable style={styles.card} onPress={() => router.push(`/project/${item.id}`)}>
            <View style={[styles.stripe, { backgroundColor: item.color }]} />
            <View style={styles.cardBody}>
              <View style={styles.cardTop}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.pinned ? '📌 ' : ''}
                  {item.name}
                </Text>
                <View style={[styles.pdot, { backgroundColor: priorityColor[item.priority] }]} />
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.meta}>{item.status}</Text>
                {item.area ? <Text style={styles.meta}>· {item.area}</Text> : null}
                {item.due ? <Text style={[styles.meta, { color: colors.amber }]}>· {fmtDue(item.due)}</Text> : null}
                <Text style={styles.meta}>· {c.done}/{c.total} done</Text>
              </View>

              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: item.color }]} />
              </View>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16 },
  newBtn: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.sm,
    paddingVertical: 13,
    alignItems: 'center',
  },
  newBtnText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  stripe: { width: 5 },
  cardBody: { flex: 1, padding: 14, gap: 9 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
  pdot: { width: 9, height: 9, borderRadius: 999 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  meta: { color: colors.textDim, fontSize: 12.5 },
  barTrack: { height: 6, borderRadius: 999, backgroundColor: colors.card2, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 999 },
});

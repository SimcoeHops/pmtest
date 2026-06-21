import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../src/store';
import { colors, radius, priorityColor, statusColor, statusLabel } from '../../src/theme';
import { fmtDue } from '../../src/format';
import { Empty } from '../../src/components/ui';
import { Loading, ErrorBanner } from '../../src/components/state';
import type { Task, TaskStatus } from '../../src/types';

const COLUMNS: TaskStatus[] = ['todo', 'doing', 'waiting', 'done'];
// Short labels so all four status tabs fit across a phone with no horizontal scroll.
const SHORT: Record<TaskStatus, string> = { todo: 'To do', doing: 'Doing', waiting: 'Waiting', done: 'Done' };

export default function Board() {
  const { state, loading, refreshing, error, refresh, updateTask } = useStore();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<TaskStatus>('todo');

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { todo: [], doing: [], waiting: [], done: [] };
    for (const t of state?.tasks ?? []) map[t.status]?.push(t);
    return map;
  }, [state]);

  function move(task: Task) {
    const others = COLUMNS.filter((c) => c !== task.status);
    Alert.alert(task.title, 'Move to…', [
      ...others.map((c) => ({
        text: statusLabel[c],
        onPress: () => updateTask(task.id, { status: c }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  if (loading && !state) return <Loading />;

  const cards = byStatus[active];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Status selector — replaces the wide horizontal kanban columns. */}
      <View style={styles.tabs}>
        {COLUMNS.map((c) => {
          const on = c === active;
          return (
            <Pressable key={c} style={[styles.tab, on && styles.tabActive]} onPress={() => setActive(c)}>
              <Text style={[styles.tabCount, { color: on ? statusColor[c] : colors.textDim }]}>
                {byStatus[c].length}
              </Text>
              <Text style={[styles.tabLabel, on && { color: colors.text }]} numberOfLines={1}>
                {SHORT[c]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}

        <View style={styles.colHeader}>
          <View style={[styles.colDot, { backgroundColor: statusColor[active] }]} />
          <Text style={styles.colTitle}>{statusLabel[active]}</Text>
        </View>

        {cards.length === 0 ? (
          <Empty text={`Nothing in "${statusLabel[active]}".`} />
        ) : (
          cards.map((t) => {
            const proj = t.projectIds.length
              ? state?.projects.find((p) => p.id === t.projectIds[0])
              : undefined;
            return (
              <Pressable key={t.id} style={styles.card} onPress={() => move(t)}>
                <Text style={styles.cardTitle} numberOfLines={3}>
                  {t.title}
                </Text>
                <View style={styles.cardMeta}>
                  <View style={[styles.pdot, { backgroundColor: priorityColor[t.priority] }]} />
                  {t.due ? <Text style={styles.metaText}>{fmtDue(t.due)}</Text> : null}
                  {t.repeat !== 'none' ? <Text style={styles.metaText}>↻</Text> : null}
                  {proj ? (
                    <Text style={[styles.metaText, { color: proj.color }]} numberOfLines={1}>
                      ● {proj.name}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.moveHint}>Tap to move →</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  tabActive: { backgroundColor: colors.card2, borderColor: colors.accent },
  tabCount: { fontSize: 19, fontWeight: '800' },
  tabLabel: { fontSize: 11.5, fontWeight: '600', color: colors.textFaint, marginTop: 1 },
  list: { paddingHorizontal: 14, paddingTop: 8, gap: 9 },
  colHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  colDot: { width: 9, height: 9, borderRadius: 999 },
  colTitle: { color: colors.textDim, fontWeight: '700', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 13,
    gap: 9,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
  pdot: { width: 7, height: 7, borderRadius: 999 },
  metaText: { color: colors.textDim, fontSize: 12.5 },
  moveHint: { color: colors.textFaint, fontSize: 11.5 },
});

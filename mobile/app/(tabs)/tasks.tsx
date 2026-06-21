import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../src/store';
import { colors, radius } from '../../src/theme';
import { isOverdue, isDueToday } from '../../src/format';
import { TaskRow } from '../../src/components/TaskRow';
import { QuickCapture } from '../../src/components/QuickCapture';
import { Empty } from '../../src/components/ui';
import { Loading, ErrorBanner } from '../../src/components/state';
import type { Task } from '../../src/types';

type Filter = 'open' | 'today' | 'overdue' | 'done';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'today', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'done', label: 'Done' },
];

export default function Tasks() {
  const { state, loading, refreshing, error, refresh } = useStore();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');

  const tasks = useMemo(() => {
    const all = state?.tasks ?? [];
    let list: Task[];
    switch (filter) {
      case 'today':
        list = all.filter((t) => t.status !== 'done' && isDueToday(t.due));
        break;
      case 'overdue':
        list = all.filter((t) => isOverdue(t.due, t.status === 'done'));
        break;
      case 'done':
        list = all.filter((t) => t.status === 'done');
        break;
      default:
        list = all.filter((t) => t.status !== 'done');
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.includes(q)),
      );
    }
    // Sort: priority weight, then due date (nulls last).
    const w = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    return list.sort((a, b) => {
      if (w[a.priority] !== w[b.priority]) return w[a.priority] - w[b.priority];
      if (!!a.due !== !!b.due) return a.due ? -1 : 1;
      return (a.due ?? '').localeCompare(b.due ?? '');
    });
  }, [state, filter, query]);

  if (loading && !state) return <Loading />;

  return (
    <View style={[styles.container, { paddingTop: 12 }]}>
      <View style={styles.header}>
        <QuickCapture />
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={colors.textFaint} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search tasks, tags, notes…"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <View style={styles.filters}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filter, filter === f.key && styles.filterActive]}
            >
              <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={tasks}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <TaskRow task={item} />}
        ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        ListHeaderComponent={error ? <ErrorBanner message={error} onRetry={refresh} /> : null}
        ListEmptyComponent={<Empty text="No tasks here." />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, gap: 12, paddingBottom: 12 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  filter: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  list: { paddingHorizontal: 16, paddingTop: 4 },
});

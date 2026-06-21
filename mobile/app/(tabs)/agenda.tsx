import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../src/store';
import { colors, radius } from '../../src/theme';
import { todayISO, addDaysISO } from '../../src/format';
import { TaskRow } from '../../src/components/TaskRow';
import { Empty } from '../../src/components/ui';
import { Loading, ErrorBanner } from '../../src/components/state';
import type { Task } from '../../src/types';

const RANGES: { days: number; label: string }[] = [
  { days: 7, label: 'Week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: 'Month' },
];

const PRIO = { critical: 0, high: 1, medium: 2, low: 3 } as const;
function sortTasks(a: Task, b: Task) {
  if (PRIO[a.priority] !== PRIO[b.priority]) return PRIO[a.priority] - PRIO[b.priority];
  return (a.due ?? '').localeCompare(b.due ?? '');
}

export default function Agenda() {
  const { state, loading, refreshing, error, refresh } = useStore();
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState(7);

  const { overdue, days } = useMemo(() => {
    const open = (state?.tasks ?? []).filter((t) => t.status !== 'done');
    const today = todayISO();
    const onDay = (t: Task, d: string) => t.due === d || (!!t.remind && t.remind.slice(0, 10) === d);
    const od = open.filter((t) => t.due && t.due < today).sort(sortTasks);
    const list: { date: string; items: Task[] }[] = [];
    for (let i = 0; i < range; i++) {
      const d = addDaysISO(i);
      list.push({ date: d, items: open.filter((t) => onDay(t, d)).sort(sortTasks) });
    }
    return { overdue: od, days: list };
  }, [state, range]);

  if (loading && !state) return <Loading />;

  const scheduled = days.reduce((n, d) => n + d.items.length, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.rangeBar}>
        {RANGES.map((r) => {
          const on = r.days === range;
          return (
            <Pressable key={r.days} style={[styles.range, on && styles.rangeOn]} onPress={() => setRange(r.days)}>
              <Text style={[styles.rangeText, on && styles.rangeTextOn]}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}

        <Text style={styles.sub}>{scheduled} scheduled · {overdue.length} overdue</Text>

        {overdue.length ? (
          <View style={[styles.day, styles.dayOverdue]}>
            <Text style={[styles.dayRel, { color: colors.red }]}>⚠ Overdue</Text>
            <View style={styles.list}>
              {overdue.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </View>
          </View>
        ) : null}

        {days.map(({ date, items }) => (
          <DayBlock key={date} date={date} items={items} />
        ))}
      </ScrollView>
    </View>
  );
}

function DayBlock({ date, items }: { date: string; items: Task[] }) {
  const d = new Date(date + 'T12:00:00');
  const t = todayISO();
  const tomorrow = addDaysISO(1);
  const rel = date === t ? 'Today' : date === tomorrow ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long' });
  const sub = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const isToday = date === t;
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
  return (
    <View style={[styles.day, isWeekend && styles.dayWeekend, isToday && styles.dayToday]}>
      <View style={styles.dayHead}>
        <Text style={[styles.dayRel, isToday && { color: colors.accent }]}>{rel}</Text>
        <Text style={styles.dayDate}>{sub}</Text>
      </View>
      {items.length ? (
        <View style={styles.list}>
          {items.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>—</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rangeBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  range: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  rangeOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  rangeText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  rangeTextOn: { color: '#fff' },
  content: { padding: 16, paddingTop: 6, gap: 12 },
  sub: { color: colors.textDim, fontSize: 13, marginBottom: 2 },
  day: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 13,
  },
  dayToday: { borderColor: colors.accent },
  dayWeekend: { backgroundColor: colors.bgSoft },
  dayOverdue: { borderColor: colors.red },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 9 },
  dayRel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  dayDate: { color: colors.textFaint, fontSize: 12.5 },
  list: { gap: 8 },
  empty: { color: colors.textFaint, fontSize: 13 },
});

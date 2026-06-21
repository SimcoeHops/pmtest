import React, { useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../src/store';
import { colors, radius } from '../../src/theme';
import { greeting, isOverdue, isDueToday, todayISO } from '../../src/format';
import { Card, SectionTitle, Empty } from '../../src/components/ui';
import { TaskRow } from '../../src/components/TaskRow';
import { Loading, ErrorBanner } from '../../src/components/state';

export default function Dashboard() {
  const { state, loading, refreshing, error, refresh, logout } = useStore();
  const insets = useSafeAreaInsets();

  const stats = useMemo(() => {
    const tasks = state?.tasks ?? [];
    const open = tasks.filter((t) => t.status !== 'done');
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return {
      overdue: open.filter((t) => isOverdue(t.due, false)).length,
      dueToday: open.filter((t) => isDueToday(t.due)).length,
      doing: tasks.filter((t) => t.status === 'doing').length,
      waiting: tasks.filter((t) => t.status === 'waiting').length,
      doneWeek: tasks.filter((t) => t.completedAt && new Date(t.completedAt) >= weekAgo).length,
    };
  }, [state]);

  const myDay = useMemo(
    () => (state?.tasks ?? []).filter((t) => t.today && t.status !== 'done'),
    [state],
  );
  const doneToday = useMemo(
    () => (state?.tasks ?? []).filter((t) => t.completedAt && t.completedAt.slice(0, 10) === todayISO()),
    [state],
  );

  if (loading && !state) return <Loading />;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
    >
      {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}

      <Text style={styles.greeting}>{greeting(state?.settings.userName ?? '')}</Text>
      <Text style={styles.sub}>Here's where things stand.</Text>

      <View style={styles.statGrid}>
        <Stat label="Overdue" value={stats.overdue} color={colors.red} />
        <Stat label="Due today" value={stats.dueToday} color={colors.amber} />
        <Stat label="In progress" value={stats.doing} color={colors.accent} />
        <Stat label="Waiting on" value={stats.waiting} color={colors.blue} />
        <Stat label="Done this week" value={stats.doneWeek} color={colors.green} />
      </View>

      <View style={styles.block}>
        <SectionTitle>☀ My Day</SectionTitle>
        {myDay.length ? (
          <View style={styles.list}>
            {myDay.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </View>
        ) : (
          <Empty text="Nothing in My Day. Add tasks with ☀ from the menu." />
        )}
      </View>

      {doneToday.length ? (
        <View style={styles.block}>
          <SectionTitle>✓ Done today</SectionTitle>
          <View style={styles.list}>
            {doneToday.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </View>
        </View>
      ) : null}

      <Pressable
        style={styles.signOut}
        onPress={() =>
          Alert.alert('Sign out?', 'You will need the password to sign back in.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => logout() },
          ])
        }
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 4 },
  greeting: { color: colors.text, fontSize: 24, fontWeight: '800' },
  sub: { color: colors.textDim, fontSize: 14, marginTop: 2, marginBottom: 16 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  stat: { flexGrow: 1, flexBasis: '30%', minWidth: 100, paddingVertical: 14 },
  statValue: { fontSize: 28, fontWeight: '800' },
  statLabel: { color: colors.textDim, fontSize: 12.5, marginTop: 2 },
  block: { marginTop: 18 },
  list: { gap: 9 },
  signOut: { marginTop: 30, alignItems: 'center', paddingVertical: 10 },
  signOutText: { color: colors.textFaint, fontSize: 14, fontWeight: '600' },
});

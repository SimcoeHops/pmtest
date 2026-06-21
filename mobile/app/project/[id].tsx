import React, { useLayoutEffect, useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../src/store';
import { colors, radius, priorityColor, statusLabel } from '../../src/theme';
import { fmtDue } from '../../src/format';
import { SectionTitle, Empty } from '../../src/components/ui';
import { TaskRow } from '../../src/components/TaskRow';
import { QuickCapture } from '../../src/components/QuickCapture';
import { Loading } from '../../src/components/state';
import { useSnackbar } from '../../src/components/Snackbar';
import type { TaskStatus } from '../../src/types';

const GROUPS: TaskStatus[] = ['doing', 'waiting', 'todo', 'done'];

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, loading, refreshing, refresh, deleteProject, restoreProject } = useStore();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const snackbar = useSnackbar();

  const project = state?.projects.find((p) => p.id === id);

  const tasks = useMemo(
    () => (state?.tasks ?? []).filter((t) => id && t.projectIds.includes(id)),
    [state, id],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: project?.name ?? 'Project',
      headerRight: () =>
        project ? (
          <Pressable
            hitSlop={10}
            onPress={async () => {
              const snapshot = project;
              const affected = tasks; // tasks to re-link if the delete is undone
              await deleteProject(project.id);
              router.back();
              snackbar.show(`Deleted "${snapshot.name}"`, {
                actionLabel: 'Undo',
                onAction: () => restoreProject(snapshot, affected),
              });
            }}
          >
            <Text style={{ color: colors.red, fontWeight: '600', fontSize: 15 }}>Delete</Text>
          </Pressable>
        ) : null,
    });
  }, [navigation, project, tasks, deleteProject, restoreProject, router, snackbar]);

  if (loading && !state) return <Loading />;
  if (!project) return <Empty text="Project not found." />;

  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.headerCard}>
        <View style={styles.headRow}>
          <View style={[styles.bigDot, { backgroundColor: project.color }]} />
          <View style={{ flex: 1 }}>
            <View style={styles.tags}>
              <Text style={styles.tag}>{project.status}</Text>
              <Text style={[styles.tag, { color: priorityColor[project.priority] }]}>{project.priority}</Text>
              {project.area ? <Text style={styles.tag}>{project.area}</Text> : null}
              {project.due ? <Text style={[styles.tag, { color: colors.amber }]}>{fmtDue(project.due)}</Text> : null}
            </View>
          </View>
        </View>
        {project.description ? <Text style={styles.desc}>{project.description}</Text> : null}
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: project.color }]} />
        </View>
        <Text style={styles.progressText}>
          {done}/{tasks.length} done · {pct}%
        </Text>
      </View>

      <View style={{ marginVertical: 16 }}>
        <QuickCapture lockProjectId={project.id} />
      </View>

      {tasks.length === 0 ? (
        <Empty text="No tasks in this project yet." />
      ) : (
        GROUPS.map((g) => {
          const group = tasks.filter((t) => t.status === g);
          if (!group.length) return null;
          return (
            <View key={g} style={{ marginBottom: 16 }}>
              <SectionTitle>
                {statusLabel[g]} · {group.length}
              </SectionTitle>
              <View style={{ gap: 9 }}>
                {group.map((t) => (
                  <TaskRow key={t.id} task={t} showProjects={false} />
                ))}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  headerCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 16,
    gap: 12,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bigDot: { width: 16, height: 16, borderRadius: 999 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  desc: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  barTrack: { height: 7, borderRadius: 999, backgroundColor: colors.card2, overflow: 'hidden' },
  barFill: { height: 7, borderRadius: 999 },
  progressText: { color: colors.textFaint, fontSize: 12.5 },
});

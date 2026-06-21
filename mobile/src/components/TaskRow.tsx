import React from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radius, priorityColor } from '../theme';
import { fmtDue, isOverdue, isDueToday } from '../format';
import { useStore } from '../store';
import { useSnackbar } from './Snackbar';
import type { Task } from '../types';

// A single task row with a tappable completion circle, due/priority/tag chips,
// and a long-press menu for status / My Day / promote / delete.
export function TaskRow({ task, showProjects = true }: { task: Task; showProjects?: boolean }) {
  const { state, updateTask, deleteTask, promoteTask, restoreTask } = useStore();
  const snackbar = useSnackbar();
  const done = task.status === 'done';
  const overdue = isOverdue(task.due, done);

  const projectNames = showProjects
    ? task.projectIds
        .map((id) => state?.projects.find((p) => p.id === id))
        .filter(Boolean)
        .slice(0, 2)
    : [];

  function toggleDone() {
    const prevStatus = task.status;
    Haptics.impactAsync(done ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
    updateTask(task.id, { status: done ? 'todo' : 'done' });
    if (!done) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Just completed it — offer an undo back to the previous status.
      snackbar.show(`Completed "${task.title}"`, {
        actionLabel: 'Undo',
        onAction: () => updateTask(task.id, { status: prevStatus }),
      });
    }
  }

  function openMenu() {
    Haptics.selectionAsync();
    Alert.alert(task.title, undefined, [
      { text: done ? 'Mark not done' : 'Mark done', onPress: toggleDone },
      {
        text: task.status === 'doing' ? 'Stop progress' : 'Mark in progress',
        onPress: () => updateTask(task.id, { status: task.status === 'doing' ? 'todo' : 'doing' }),
      },
      {
        text: task.status === 'waiting' ? 'Stop waiting' : 'Mark waiting on',
        onPress: () => updateTask(task.id, { status: task.status === 'waiting' ? 'todo' : 'waiting' }),
      },
      {
        text: task.today ? 'Remove from My Day' : 'Add to My Day',
        onPress: () => updateTask(task.id, { today: !task.today }),
      },
      {
        text: 'Promote to project',
        onPress: () =>
          Alert.alert('Promote to project?', 'Subtasks become tasks in a new project.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Promote', onPress: () => promoteTask(task.id) },
          ]),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const snapshot = task;
          deleteTask(task.id);
          snackbar.show(`Deleted "${task.title}"`, {
            actionLabel: 'Undo',
            onAction: () => restoreTask(snapshot),
          });
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <Pressable
      onPress={toggleDone}
      onLongPress={openMenu}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.circle, done && styles.circleDone]}>
        {done && <Text style={styles.check}>✓</Text>}
      </View>

      <View style={styles.body}>
        <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
          {task.today && !done ? '☀ ' : ''}
          {task.title}
        </Text>

        <View style={styles.meta}>
          <View style={[styles.pdot, { backgroundColor: priorityColor[task.priority] }]} />
          {task.due ? (
            <Text style={[styles.metaText, overdue && { color: colors.red }, isDueToday(task.due) && !done && { color: colors.amber }]}>
              {fmtDue(task.due)}
            </Text>
          ) : null}
          {task.repeat !== 'none' ? <Text style={styles.metaText}>↻</Text> : null}
          {projectNames.map((p) => (
            <Text key={p!.id} style={[styles.metaText, { color: p!.color }]} numberOfLines={1}>
              ● {p!.name}
            </Text>
          ))}
          {task.tags.slice(0, 2).map((t) => (
            <Text key={t} style={styles.metaText}>
              #{t}
            </Text>
          ))}
        </View>
      </View>

      <Pressable hitSlop={10} onPress={openMenu} style={styles.more}>
        <Text style={styles.moreText}>⋯</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 12,
    gap: 11,
  },
  rowPressed: { opacity: 0.65, backgroundColor: colors.card2 },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  circleDone: { backgroundColor: colors.green, borderColor: colors.green },
  check: { color: '#06231a', fontSize: 13, fontWeight: '900', lineHeight: 15 },
  body: { flex: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  titleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9, marginTop: 6 },
  pdot: { width: 7, height: 7, borderRadius: 999 },
  metaText: { color: colors.textDim, fontSize: 12.5 },
  more: { paddingHorizontal: 4 },
  moreText: { color: colors.textFaint, fontSize: 22, lineHeight: 22 },
});

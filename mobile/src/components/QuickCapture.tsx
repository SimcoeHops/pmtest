import React, { useState } from 'react';
import { View, TextInput, Pressable, Text, StyleSheet, Keyboard } from 'react-native';
import { colors, radius, priorityColor } from '../theme';
import { fmtDue } from '../format';
import { parseCapture } from '../capture';
import { useStore } from '../store';

// Smart-syntax capture box. `lockProjectId` pre-assigns the new task to a project
// (used on the project detail screen).
export function QuickCapture({ lockProjectId }: { lockProjectId?: string }) {
  const { state, addTask } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const projects = state?.projects ?? [];
  const parsed = text.trim() ? parseCapture(text, projects) : null;

  async function submit() {
    const p = parseCapture(text, projects);
    if (!p.title) return;
    const projectIds = lockProjectId
      ? Array.from(new Set([lockProjectId, ...p.projectIds]))
      : p.projectIds;
    setBusy(true);
    try {
      await addTask({
        title: p.title,
        priority: p.priority,
        tags: p.tags,
        due: p.due,
        projectIds,
      });
      setText('');
      Keyboard.dismiss();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Add a task…  @project #tag !high ^fri"
          placeholderTextColor={colors.textFaint}
          returnKeyType="done"
          onSubmitEditing={submit}
          blurOnSubmit={false}
          autoCapitalize="sentences"
        />
        <Pressable
          style={[styles.add, (!parsed?.title || busy) && styles.addDisabled]}
          onPress={submit}
          disabled={!parsed?.title || busy}
        >
          <Text style={styles.addText}>＋</Text>
        </Pressable>
      </View>

      {parsed && (parsed.due || parsed.tags.length || parsed.projectIds.length || parsed.priority !== 'medium') ? (
        <View style={styles.preview}>
          {parsed.priority !== 'medium' ? (
            <Text style={[styles.pv, { color: priorityColor[parsed.priority] }]}>!{parsed.priority}</Text>
          ) : null}
          {parsed.due ? <Text style={[styles.pv, { color: colors.amber }]}>📅 {fmtDue(parsed.due)}</Text> : null}
          {parsed.projectIds.map((id) => {
            const proj = projects.find((p) => p.id === id);
            return proj ? (
              <Text key={id} style={[styles.pv, { color: proj.color }]}>
                ● {proj.name}
              </Text>
            ) : null;
          })}
          {parsed.tags.map((t) => (
            <Text key={t} style={[styles.pv, { color: colors.textDim }]}>
              #{t}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  inputRow: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
  },
  add: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addDisabled: { opacity: 0.4 },
  addText: { color: '#fff', fontSize: 24, fontWeight: '700', lineHeight: 26 },
  preview: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 4 },
  pv: { fontSize: 12.5, fontWeight: '600' },
});

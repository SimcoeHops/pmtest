import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { colors } from '../../src/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IoniconName) {
  return ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <Ionicons name={(focused ? name : (`${name}-outline` as IoniconName))} size={size} color={color} />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgSoft },
        headerTitleStyle: { color: colors.text, fontWeight: '700' },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.bgSoft,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Dashboard', tabBarLabel: 'Home', tabBarIcon: tabIcon('home') }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: 'Tasks', tabBarIcon: tabIcon('checkmark-circle') }}
      />
      <Tabs.Screen
        name="agenda"
        options={{ title: 'Agenda', tabBarIcon: tabIcon('calendar') }}
      />
      <Tabs.Screen
        name="projects"
        options={{ title: 'Projects', tabBarIcon: tabIcon('albums') }}
      />
      <Tabs.Screen
        name="board"
        options={{ title: 'Board', tabBarIcon: tabIcon('grid') }}
      />
    </Tabs>
  );
}

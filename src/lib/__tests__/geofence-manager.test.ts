/**
 * Integration-style tests for the geofence pipeline: the TaskManager task is
 * captured from defineTask and invoked with synthetic Enter events, with the
 * real settings/cluster/cooldown/engagement modules running against an
 * in-memory persisted-file store. Only the native edges (expo-location,
 * expo-notifications, expo-task-manager, react-native) are mocked.
 */
const mockStore = new Map<string, string>();
const mockDefinedTasks = new Map<
  string,
  (body: { data: unknown; error: unknown }) => Promise<void>
>();
const mockShowBanner = jest.fn();
const mockScheduleNotification = jest.fn(async () => 'notification-id');
const mockStartGeofencing = jest.fn(async () => {});
const mockStopGeofencing = jest.fn(async () => {});
const mockIsTaskRegistered = jest.fn(async () => true);
const mockWatchRemove = jest.fn();
let mockWatchCb:
  | ((pos: { coords: { latitude: number; longitude: number } }) => void)
  | null = null;
const mockWatchPosition = jest.fn(
  async (
    _opts: unknown,
    cb: (pos: { coords: { latitude: number; longitude: number } }) => void
  ) => {
    mockWatchCb = cb;
    return { remove: mockWatchRemove };
  }
);
const mockGetLastKnown = jest.fn(async (): Promise<unknown> => null);
const mockAppState: { currentState: string; addEventListener: jest.Mock } = {
  currentState: 'background',
  addEventListener: jest.fn(),
};
let mockIndex: unknown = null;

jest.mock('react-native', () => ({
  AppState: mockAppState,
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios },
}));

jest.mock('expo-location', () => ({
  GeofencingEventType: { Enter: 1, Exit: 2 },
  Accuracy: { Balanced: 3 },
  startGeofencingAsync: mockStartGeofencing,
  stopGeofencingAsync: mockStopGeofencing,
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 34.0, longitude: -117.0 },
  })),
  getLastKnownPositionAsync: mockGetLastKnown,
  watchPositionAsync: mockWatchPosition,
}));

jest.mock('expo-media-library', () => ({
  MediaType: { IMAGE: 'photo', VIDEO: 'video' },
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: mockScheduleNotification,
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: (name: string, fn: never) => {
    mockDefinedTasks.set(name, fn);
  },
  isTaskRegisteredAsync: mockIsTaskRegistered,
}));

jest.mock('@/lib/persisted-file', () => ({
  persistedFile: (name: string) => ({
    get exists() {
      return mockStore.has(name);
    },
    create: () => {
      if (!mockStore.has(name)) mockStore.set(name, '');
    },
    write: (text: string) => {
      mockStore.set(name, text);
    },
  }),
  readPersisted: async (name: string) => mockStore.get(name) ?? null,
}));

jest.mock('@/hooks/use-located-assets', () => ({
  ensureIndex: jest.fn(async () => mockIndex),
  getIndex: jest.fn(() => mockIndex),
  invalidateIndex: jest.fn(),
  loadIndexFromDisk: jest.fn(async () => mockIndex),
}));

jest.mock('@/lib/foreground-banner', () => ({ showBanner: mockShowBanner }));

const DAY = 24 * 60 * 60 * 1000;
const OLD = Date.now() - 400 * DAY;
const RECENT = Date.now() - 5 * DAY;

// Grid cell ids for CELL_SIZE_DEG = 0.0005 at lng -117 (lng cell -234000).
const LAT_A = 34.0; // cell 68000 -> ~55m south of B
const LAT_B = 34.0005; // cell 68001
const LAT_C = 34.001; // cell 68002, ~111m from A (still inside the 150m routine area)
const LAT_RECENT = 34.0008; // cell 68002, ~89m from A (inside the 150m area)
const ID_A = '68000,-234000';
const ID_B = '68001,-234000';
const ID_C = '68002,-234000';

function locatedAsset(id: string, lat: number, creationTime: number) {
  return { id, lat, lng: -117.0, creationTime, mediaType: 'photo' };
}

function setIndex(assets: ReturnType<typeof locatedAsset>[]) {
  mockIndex = { located: assets, unlocatedVideos: [], processedIds: [] };
}

function enableNotifications(enabled = true) {
  mockStore.set('notification-settings.json', JSON.stringify({ enabled }));
}

type Manager = typeof import('@/lib/geofence-manager');

function loadManager(): {
  mgr: Manager;
  enter: (clusterId: string) => Promise<void>;
} {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mgr = require('@/lib/geofence-manager') as Manager;
  const task = mockDefinedTasks.get(mgr.GEOFENCE_TASK_NAME)!;
  const enter = (clusterId: string) =>
    task({
      data: { eventType: 1, region: { identifier: clusterId } },
      error: null,
    });
  return { mgr, enter };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockDefinedTasks.clear();
  mockAppState.currentState = 'background';
  mockIndex = null;
  mockWatchCb = null;
});

// Drain the microtask queue (fire-and-forget watch callbacks settle in it).
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// One old single-photo cluster every ~111m heading north from (34, -117).
function manyOldAssets(count: number) {
  return Array.from({ length: count }, (_, i) =>
    locatedAsset(`p${i}`, 34.0 + i * 0.001, OLD)
  );
}

describe('geofence enter handling', () => {
  it('schedules a system notification when backgrounded', async () => {
    enableNotifications();
    setIndex([locatedAsset('a', LAT_A, OLD)]);
    const { enter } = loadManager();

    await enter(ID_A);

    expect(mockScheduleNotification).toHaveBeenCalledTimes(1);
    const call = mockScheduleNotification.mock.calls[0] as unknown as [
      { content: { data: { clusterId: string } }; trigger: unknown },
    ];
    expect(call[0].content.data.clusterId).toBe(ID_A);
    expect(call[0].trigger).toEqual({ channelId: 'memories' });
    expect(mockShowBanner).not.toHaveBeenCalled();
    // Cooldown + presence were recorded.
    expect(mockStore.has('notification-cooldown.json')).toBe(true);
    expect(mockStore.has('place-presence.json')).toBe(true);
  });

  it('shows the in-app banner instead when the app is active', async () => {
    enableNotifications();
    setIndex([locatedAsset('a', LAT_A, OLD), locatedAsset('b', LAT_A, OLD)]);
    mockAppState.currentState = 'active';
    const { enter } = loadManager();

    await enter(ID_A);

    expect(mockShowBanner).toHaveBeenCalledWith({
      kind: 'cluster',
      clusterId: ID_A,
      count: 2,
    });
    expect(mockScheduleNotification).not.toHaveBeenCalled();
  });

  it('does nothing when the feature is disabled', async () => {
    enableNotifications(false);
    setIndex([locatedAsset('a', LAT_A, OLD)]);
    const { enter } = loadManager();

    await enter(ID_A);

    expect(mockScheduleNotification).not.toHaveBeenCalled();
    expect(mockShowBanner).not.toHaveBeenCalled();
  });

  it('suppresses a cluster when recent media exists within 150m', async () => {
    enableNotifications();
    setIndex([
      locatedAsset('old', LAT_A, OLD),
      locatedAsset('recent', LAT_RECENT, RECENT),
    ]);
    const { enter } = loadManager();

    await enter(ID_A);

    expect(mockScheduleNotification).not.toHaveBeenCalled();
    expect(mockShowBanner).not.toHaveBeenCalled();
  });

  it('goes silent at a routine place (home/work) after enough distinct days', async () => {
    enableNotifications();
    // Three distinct clusters within the 150m routine radius. Using distinct ids
    // (not the same spot three times) keeps the per-cluster 90-day cooldown from
    // shadowing the test — each day's enter is a different cluster, so the only
    // thing that silences the third day is routine detection.
    setIndex([
      locatedAsset('a', LAT_A, OLD),
      locatedAsset('b', LAT_B, OLD),
      locatedAsset('c', LAT_C, OLD),
    ]);
    const { enter } = loadManager();
    const base = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');

    // Visit the same place (within 150m) on three distinct days. The location
    // cooldown doesn't apply (days apart), so routine detection is what silences.
    nowSpy.mockReturnValue(base);
    await enter(ID_A);
    nowSpy.mockReturnValue(base + DAY);
    await enter(ID_B);
    nowSpy.mockReturnValue(base + 2 * DAY); // third distinct day → routine
    await enter(ID_C);

    // Notified on the first two days, then recognized as home/work and muted.
    expect(mockScheduleNotification).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it('does not re-notify the same cluster within 90 days', async () => {
    enableNotifications();
    setIndex([locatedAsset('a', LAT_A, OLD)]);
    const { enter } = loadManager();
    const base = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(base);
    await enter(ID_A);
    // 30 days later: the location cooldown has long expired and two visits a
    // month apart aren't routine, so only the per-cluster cooldown holds it back.
    nowSpy.mockReturnValue(base + 30 * DAY);
    await enter(ID_A);

    expect(mockScheduleNotification).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it('re-notifies the same cluster after the 90-day window', async () => {
    enableNotifications();
    setIndex([locatedAsset('a', LAT_A, OLD)]);
    const { enter } = loadManager();
    const base = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(base);
    await enter(ID_A);
    nowSpy.mockReturnValue(base + 91 * DAY); // past the per-cluster window
    await enter(ID_A);

    expect(mockScheduleNotification).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it('notifies a nearby cluster only once: location cooldown covers the radius', async () => {
    enableNotifications();
    setIndex([locatedAsset('a', LAT_A, OLD), locatedAsset('b', LAT_B, OLD)]);
    const { enter } = loadManager();

    await enter(ID_A);
    await enter(ID_B); // ~55m away, same arrival (inside the ~100m quiet zone)

    expect(mockScheduleNotification).toHaveBeenCalledTimes(1);
  });

  it('notifies only once even when overlapping regions fire concurrently', async () => {
    enableNotifications();
    setIndex([locatedAsset('a', LAT_A, OLD), locatedAsset('b', LAT_B, OLD)]);
    const { enter } = loadManager();

    // Overlapping 120m regions deliver both Enter events at the same time.
    await Promise.all([enter(ID_A), enter(ID_B)]);

    expect(mockScheduleNotification).toHaveBeenCalledTimes(1);
  });

  it('ignores task errors and non-Enter events', async () => {
    enableNotifications();
    setIndex([locatedAsset('a', LAT_A, OLD)]);
    const { mgr } = loadManager();
    const task = mockDefinedTasks.get(mgr.GEOFENCE_TASK_NAME)!;

    await task({ data: null, error: { message: 'boom' } });
    await task({
      data: { eventType: 2, region: { identifier: ID_A } }, // Exit
      error: null,
    });

    expect(mockScheduleNotification).not.toHaveBeenCalled();
  });
});

describe('geofence registration', () => {
  it('registers enter-only regions; dense clusters clamp to the 120m floor', async () => {
    enableNotifications();
    // A and B sit ~55m apart — a dense pair, so the adaptive radius clamps to
    // the 120m geofence floor (unchanged from the old fixed behavior).
    setIndex([locatedAsset('a', LAT_A, OLD), locatedAsset('b', LAT_B, OLD)]);
    const { mgr } = loadManager();

    await mgr.startOrRefreshGeofences(34.0, -117.0, []);

    expect(mockStartGeofencing).toHaveBeenCalledTimes(1);
    const [taskName, regions] = mockStartGeofencing.mock.calls[0] as unknown as [
      string,
      {
        identifier: string;
        radius: number;
        notifyOnEnter: boolean;
        notifyOnExit: boolean;
      }[],
    ];
    expect(taskName).toBe(mgr.GEOFENCE_TASK_NAME);
    expect(regions.map((r) => r.identifier).sort()).toEqual([ID_A, ID_B]);
    for (const r of regions) {
      expect(r.radius).toBe(120);
      expect(r.notifyOnEnter).toBe(true);
      expect(r.notifyOnExit).toBe(false);
    }
  });

  it('widens enter regions in a sparse area to the ceiling', async () => {
    enableNotifications();
    // Two old clusters ~1km apart: a spread-out area, so each region widens to
    // the 250m ceiling rather than the dense 120m floor — a far-flung memory
    // still triggers, but capped well under the old quarter-mile reach.
    setIndex([locatedAsset('a', 34.0, OLD), locatedAsset('far', 34.009, OLD)]);
    const { mgr } = loadManager();

    await mgr.startOrRefreshGeofences(34.0, -117.0, []);

    const [, regions] = mockStartGeofencing.mock.calls[0] as unknown as [
      string,
      { identifier: string; radius: number }[],
    ];
    expect(regions).toHaveLength(2);
    for (const r of regions) {
      expect(r.radius).toBe(250);
    }
  });

  it('excludes recently-visited clusters from registration', async () => {
    setIndex([
      locatedAsset('old', LAT_A, OLD),
      // ~890m away and recent — not notifiable, but far enough not to
      // area-suppress the old cluster.
      locatedAsset('recent', 34.008, RECENT),
    ]);
    const { mgr } = loadManager();

    await mgr.startOrRefreshGeofences(34.0, -117.0, []);

    const [, regions] = mockStartGeofencing.mock.calls[0] as unknown as [
      string,
      { identifier: string }[],
    ];
    expect(regions.map((r) => r.identifier)).toEqual([ID_A]);
  });

  it('stops geofencing when no clusters are notifiable', async () => {
    setIndex([locatedAsset('recent', LAT_A, RECENT)]);
    const { mgr } = loadManager();

    await mgr.startOrRefreshGeofences(34.0, -117.0, []);

    expect(mockStartGeofencing).not.toHaveBeenCalled();
    expect(mockStopGeofencing).toHaveBeenCalledTimes(1);
  });

  it('re-registers after a disable/enable cycle without moving (regression)', async () => {
    setIndex([locatedAsset('a', LAT_A, OLD)]);
    const { mgr } = loadManager();

    await mgr.startOrRefreshGeofences(34.0, -117.0, []);
    // Just registered here: rotation says nothing to do.
    expect(mgr.shouldRotateGeofences(34.0, -117.0)).toBe(false);

    // Toggling the feature off stops geofencing; turning it back on at the
    // same spot must re-register rather than ride the stale rotation anchor.
    await mgr.stopGeofencingIfActive();
    expect(mgr.shouldRotateGeofences(34.0, -117.0)).toBe(true);
  });

  it('rotates after moving 500m or after 6 hours', async () => {
    setIndex([locatedAsset('a', LAT_A, OLD)]);
    const { mgr } = loadManager();

    await mgr.startOrRefreshGeofences(34.0, -117.0, []);
    expect(mgr.shouldRotateGeofences(34.001, -117.0)).toBe(false); // ~110m
    expect(mgr.shouldRotateGeofences(34.006, -117.0)).toBe(true); // ~670m
    expect(
      mgr.shouldRotateGeofences(34.0, -117.0, Date.now() + 7 * 60 * 60 * 1000)
    ).toBe(true);
  });
});

describe('re-anchor boundary', () => {
  it('reserves the last slot for an exit-only boundary when clusters overflow', async () => {
    setIndex(manyOldAssets(25));
    const { mgr } = loadManager();

    await mgr.startOrRefreshGeofences(34.0, -117.0, []);

    const [, regions] = mockStartGeofencing.mock.calls[0] as unknown as [
      string,
      {
        identifier: string;
        latitude: number;
        radius: number;
        notifyOnEnter: boolean;
        notifyOnExit: boolean;
      }[],
    ];
    expect(regions).toHaveLength(20);
    const boundary = regions.find(
      (r) => r.identifier === mgr.BOUNDARY_REGION_ID
    )!;
    expect(boundary.notifyOnExit).toBe(true);
    expect(boundary.notifyOnEnter).toBe(false);
    expect(boundary.latitude).toBe(34.0);
    // The nearest cluster left out is #19 (~2.1km away); the boundary reaches
    // just short of it.
    expect(boundary.radius).toBeGreaterThan(1800);
    expect(boundary.radius).toBeLessThan(2120);
    expect(
      regions.filter((r) => r.identifier !== mgr.BOUNDARY_REGION_ID)
    ).toHaveLength(19);
  });

  it('registers no boundary when every notifiable cluster fits', async () => {
    setIndex([locatedAsset('a', LAT_A, OLD), locatedAsset('b', LAT_B, OLD)]);
    const { mgr } = loadManager();

    await mgr.startOrRefreshGeofences(34.0, -117.0, []);

    const [, regions] = mockStartGeofencing.mock.calls[0] as unknown as [
      string,
      { identifier: string }[],
    ];
    expect(regions.map((r) => r.identifier)).not.toContain(
      mgr.BOUNDARY_REGION_ID
    );
  });

  it('re-anchors around the new position on a boundary exit', async () => {
    enableNotifications();
    setIndex(manyOldAssets(25));
    const { mgr } = loadManager();
    const task = mockDefinedTasks.get(mgr.GEOFENCE_TASK_NAME)!;
    // The user surfaced ~2.7km north of the old anchor.
    mockGetLastKnown.mockResolvedValueOnce({
      coords: { latitude: 34.024, longitude: -117.0 },
    });

    await task({
      data: { eventType: 2, region: { identifier: mgr.BOUNDARY_REGION_ID } },
      error: null,
    });

    expect(mockStartGeofencing).toHaveBeenCalledTimes(1);
    const [, regions] = mockStartGeofencing.mock.calls[0] as unknown as [
      string,
      { identifier: string }[],
    ];
    const ids = regions.map((r) => r.identifier);
    // Cluster #24 sits at the new position and is now registered…
    expect(ids).toContain('68048,-234000');
    // …while the far end near the old anchor fell out of the set.
    expect(ids).not.toContain(ID_A);
  });

  it('ignores boundary enters and does not re-anchor while disabled', async () => {
    enableNotifications(false);
    setIndex(manyOldAssets(25));
    const { mgr } = loadManager();
    const task = mockDefinedTasks.get(mgr.GEOFENCE_TASK_NAME)!;

    await task({
      data: { eventType: 1, region: { identifier: mgr.BOUNDARY_REGION_ID } },
      error: null,
    });
    await task({
      data: { eventType: 2, region: { identifier: mgr.BOUNDARY_REGION_ID } },
      error: null,
    });

    expect(mockStartGeofencing).not.toHaveBeenCalled();
  });
});

describe('foreground fallback', () => {
  it('banners through the shared enter pipeline while the app is open', async () => {
    enableNotifications();
    setIndex([locatedAsset('a', LAT_A, OLD)]);
    mockAppState.currentState = 'active';
    const { mgr } = loadManager();

    await mgr.startForegroundFallback();
    expect(mockWatchPosition).toHaveBeenCalledTimes(1);

    mockWatchCb!({ coords: { latitude: LAT_A, longitude: -117.0 } });
    await flush();
    expect(mockShowBanner).toHaveBeenCalledWith({
      kind: 'cluster',
      clusterId: ID_A,
      count: 1,
    });

    // Drifting within the same place stays quiet — the cooldown holds.
    mockWatchCb!({ coords: { latitude: LAT_A + 0.0002, longitude: -117.0 } });
    await flush();
    expect(mockShowBanner).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when no notifiable cluster is within the local radius', async () => {
    enableNotifications();
    setIndex([locatedAsset('a', LAT_A, OLD)]);
    mockAppState.currentState = 'active';
    const { mgr } = loadManager();
    await mgr.startForegroundFallback();

    // ~1.1km away — beyond even the widest (250m ceiling) adaptive radius.
    mockWatchCb!({ coords: { latitude: LAT_A + 0.01, longitude: -117.0 } });
    await flush();

    expect(mockShowBanner).not.toHaveBeenCalled();
  });

  it('start is idempotent and stop removes the watch', async () => {
    setIndex([locatedAsset('a', LAT_A, OLD)]);
    const { mgr } = loadManager();

    await mgr.startForegroundFallback();
    await mgr.startForegroundFallback();
    expect(mockWatchPosition).toHaveBeenCalledTimes(1);

    mgr.stopForegroundFallback();
    expect(mockWatchRemove).toHaveBeenCalledTimes(1);
  });
});

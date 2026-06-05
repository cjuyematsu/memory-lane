import { File, Paths } from 'expo-file-system';

// Notification state (the enabled flag, cooldown, engagement) and the located
// index must survive cache eviction, so they live in the document directory —
// which the OS does not purge under storage pressure and which is backed up.
// Files written to the old cache location are migrated on first read so
// existing installs don't lose their settings.

export function persistedFile(name: string): File {
  return new File(Paths.document, name);
}

export async function readPersisted(name: string): Promise<string | null> {
  const doc = new File(Paths.document, name);
  if (doc.exists) {
    try {
      return await doc.text();
    } catch {
      return null;
    }
  }
  // One-time migration from the legacy cache location.
  const legacy = new File(Paths.cache, name);
  if (legacy.exists) {
    try {
      const text = await legacy.text();
      try {
        doc.create();
        doc.write(text);
      } catch {
        // best-effort migration; the legacy copy is still readable next time
      }
      return text;
    } catch {
      return null;
    }
  }
  return null;
}

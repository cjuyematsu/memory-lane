import { PermissionsAndroid, Platform } from 'react-native';

import { AssetField, MediaType, Query } from 'expo-media-library';

// Dev-only probe for the Android photo-metadata issues (blank thumbnails, no
// date/place). It answers the two open questions with data instead of guesses:
//   1. Is ACCESS_MEDIA_LOCATION actually granted at runtime? (getLocation /
//      getExif THROW on Android when it isn't.) If requesting it flips the
//      grant silently, the real fix is to request it during onboarding.
//   2. For a sample of photos, does getLocation() succeed / return null / throw,
//      and is creationTime present — so we know whether missing places are a
//      permission problem or just photos with no GPS.
// It also prints id (content://) vs getUri() (file://) to confirm why the
// file:// image source rendered blank.
export async function diagnoseAndroidMetadata(sampleSize = 25): Promise<string> {
  if (Platform.OS !== 'android') {
    return 'Diagnostic is Android-only — on iOS, PHAsset exposes location directly.';
  }

  const PERM = PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION;
  let granted = await PermissionsAndroid.check(PERM);
  let requestNote = '';
  if (!granted) {
    const res = await PermissionsAndroid.request(PERM);
    granted = res === PermissionsAndroid.RESULTS.GRANTED;
    requestNote = ` (was denied; request -> ${res})`;
  }

  const assets = await new Query()
    .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE])
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .limit(sampleSize)
    .exe();

  let locOk = 0;
  let locNull = 0;
  let locThrew = 0;
  let timeOk = 0;
  let timeNull = 0;
  let fileUri = 0;
  let otherUri = 0;

  for (const a of assets) {
    try {
      const loc = await a.getLocation();
      if (loc) locOk++;
      else locNull++;
    } catch {
      locThrew++;
    }
    try {
      const info = await a.getInfo();
      if ((info.creationTime ?? info.modificationTime) != null) timeOk++;
      else timeNull++;
    } catch {
      timeNull++;
    }
    try {
      const uri = await a.getUri();
      if (uri.startsWith('file://')) fileUri++;
      else otherUri++;
    } catch {
      otherUri++;
    }
  }

  return [
    `ACCESS_MEDIA_LOCATION: ${granted ? 'GRANTED' : 'DENIED'}${requestNote}`,
    `Sampled ${assets.length} photos:`,
    `getLocation -> ${locOk} ok / ${locNull} null / ${locThrew} threw`,
    `date present -> ${timeOk} / ${timeNull} missing`,
    `getUri -> ${fileUri} file:// / ${otherUri} other`,
    `id (image source): ${assets[0]?.id ?? 'n/a'}`,
  ].join('\n');
}

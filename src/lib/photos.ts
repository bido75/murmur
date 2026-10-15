// Site photos: take or pick one, shrink it for upload, and queue it with its moment in the recording.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { isWeb } from './dialog';
import { uuid } from './format';
import { enqueue, keepPhoto } from './sync';

const MAX_SIDE = 1600; // plenty for a report slide or a punch item, ~300 KB as JPEG

export type Shot = { uri: string; width: number; height: number };

/** Long side scaled down to MAX_SIDE, never up. Pure; exported for tests. */
export function fitSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  if (!width || !height) return { width, height };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function takePhoto(source: 'camera' | 'library'): Promise<Shot | null> {
  if (source === 'camera' && !isWeb) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission is off. Turn it on in Settings to take site photos.');
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9, exif: false, allowsEditing: false };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  try {
    const size = fitSize(a.width, a.height);
    const ctx = ImageManipulator.manipulate(a.uri);
    if (size.width && size.width < a.width) ctx.resize({ width: size.width });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.72 });
    return { uri: out.uri, width: out.width, height: out.height };
  } catch {
    // Resizing is an optimization; the original still works.
    return { uri: a.uri, width: a.width, height: a.height };
  }
}

/** Keep the photo on the phone and queue its upload. `takenMs` is its position in the recording. */
export async function queuePhoto(recordingId: string, shot: Shot, takenMs: number | null): Promise<string> {
  const photoId = uuid();
  const localUri = keepPhoto(shot.uri, recordingId, photoId);
  await enqueue({ kind: 'photo', recordingId, photoId, localUri, takenMs: takenMs == null ? null : Math.max(0, Math.round(takenMs)), width: shot.width, height: shot.height });
  return photoId;
}

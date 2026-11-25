export const SCENE_IDS = ['cafe', 'molido', 'super', 'origenes', 'reunion'] as const;
export type SceneId = typeof SCENE_IDS[number];

export const SCROLL_STOP = [0, .2, .4, .65, .85, 1] as const;
// The two orientations share the same cuts. Times refer to the supplied 22.542 s master.
export const DEFAULT_MARKS = [0, 2.833, 10.417, 18.125, 22.5] as const;

export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

function ease(n: number) {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
}

export function validMarks(values: number[]) {
  return values.length === DEFAULT_MARKS.length &&
    values[0] === 0 &&
    values.every((value, i) => Number.isFinite(value) && (i === 0 || value > values[i - 1] + 1 / 24));
}

export function sceneAt(progress: number) {
  const t = clamp(progress);
  const i = SCROLL_STOP.findIndex((stop, index) => index > 0 && t < stop) - 1;
  return i >= 0 ? i : SCENE_IDS.length - 1;
}

export function scenePose(progress: number) {
  const index = sceneAt(progress);
  const start = SCROLL_STOP[index], end = SCROLL_STOP[index + 1];
  const enter = index === 0 ? 1 : ease((progress - start) / .028);
  const leave = index === SCENE_IDS.length - 1 ? 1 : ease((end - progress) / .024);
  return {
    index,
    opacity: Math.min(enter, leave),
    offset: (1 - enter) * 24 - (1 - leave) * 24,
    blur: 16 * ease((progress - SCROLL_STOP[4]) / .044),
  };
}

export function originsCardEntry(progress: number) {
  // Let the scene begin before opening the cards; #productos lands after they settle.
  return ease((progress - SCROLL_STOP[3] - .01) / .065);
}

export function filmTime(progress: number, duration: number, marks: readonly number[] = DEFAULT_MARKS) {
  if (!(duration > 0) || !Number.isFinite(duration)) return 0;
  const time = clamp(progress);
  const last = Math.max(0, duration - 1 / 48);
  const index = sceneAt(time);
  if (index >= marks.length - 1) return Math.min(marks.at(-1) ?? last, last);
  const distance = (time - SCROLL_STOP[index]) / (SCROLL_STOP[index + 1] - SCROLL_STOP[index]);
  return clamp(marks[index] + distance * (marks[index + 1] - marks[index]), 0, last);
}

export function readableStop(index: number) {
  return index === 0 ? 0 : SCROLL_STOP[index] + (SCROLL_STOP[index + 1] - SCROLL_STOP[index]) * .45;
}

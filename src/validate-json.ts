import { errors } from './errors';

const MAX_DEPTH = 50;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function depthExceeds(value: unknown, limit: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (node && typeof node === 'object') {
      if (depth > limit) return true;
      for (const child of Object.values(node as Record<string, unknown>)) stack.push([child, depth + 1]);
    }
  }
  return false;
}

export function parseData(buffer: Uint8Array): JsonValue {
  let text = new TextDecoder().decode(buffer);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw errors.badRequest('INVALID_JSON', 'The uploaded data file is not valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw errors.badRequest('INVALID_JSON_ROOT', 'The JSON root must be an object or an array.');
  }
  if (depthExceeds(parsed, MAX_DEPTH)) {
    throw errors.badRequest('JSON_TOO_DEEP', `The JSON nesting depth exceeds ${MAX_DEPTH}.`);
  }
  return parsed as JsonValue;
}

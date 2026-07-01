/**
 * 이벤트 ID 생성기
 *
 * 편집 계획은 서버/클라이언트 어디서든 동일하게 재현 가능해야 하므로,
 * 랜덤 대신 타입별 증가 카운터로 결정적인 ID 를 만든다.
 */

const counters: Record<string, number> = {};

export function makeId(prefix: string): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}_${counters[prefix]}`;
}

/** 한 번의 편집 계획 생성마다 카운터를 초기화한다. */
export function resetIds(): void {
  for (const key of Object.keys(counters)) delete counters[key];
}

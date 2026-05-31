// key 단위로 비동기 작업을 직렬화하는 경량 뮤텍스.
// 같은 key에 대한 동시 호출(예: 같은 매치 승패확정 더블클릭)을 큐에 줄세워
// read-modify-write 인터리브로 인한 업데이트 유실을 막는다.

const chains = new Map();

/**
 * 같은 key의 작업을 순차 실행한다.
 * @param {string|number} key 직렬화 단위 (예: gameId)
 * @param {() => Promise<T>} fn 실행할 작업
 * @returns {Promise<T>} fn의 결과(또는 에러)를 그대로 전달
 */
function withLock(key, fn) {
  const k = String(key);
  const prev = chains.get(k) || Promise.resolve();

  // 이전 작업이 끝난 뒤 fn 실행. 호출자에게는 fn의 결과/에러를 그대로 반환.
  const run = prev.then(() => fn());

  // 다음 작업이 이전 에러로 죽지 않도록 에러를 삼킨 버전을 체인 꼬리로 저장.
  const guarded = run.catch(() => {});
  chains.set(k, guarded);

  // 이 작업이 마지막이면 map 엔트리 정리(메모리 누수 방지).
  guarded.then(() => {
    if (chains.get(k) === guarded) chains.delete(k);
  });

  return run;
}

module.exports = { withLock };

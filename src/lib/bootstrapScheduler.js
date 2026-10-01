// Small concurrency limiter for bootstrap requests. Results keep task order.
export async function runBootstrapTasks(tasks, { limit = 3, priority = [] } = {}) {
  const ordered = [...new Set([...priority, ...tasks.map((_, index) => index)])];
  const results = Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < ordered.length) {
      const taskIndex = ordered[cursor++];
      try { results[taskIndex] = await tasks[taskIndex](); }
      catch { results[taskIndex] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, ordered.length) }, worker));
  return results;
}

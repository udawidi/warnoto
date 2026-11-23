// Recheck at invocation because review dialogs may stay open across a refresh.
export function createTugWriteGuard(canWrite, onBlocked) {
  return action => (...args) => {
    if (canWrite()) return action(...args);
    onBlocked();
    return false;
  };
}

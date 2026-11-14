// The unit-test builder runs the spec files in one environment that is not reset
// between them (`isolate: false`): what a spec writes to localStorage (a language
// chosen with `use('fr')`, a saved view...) reaches the files that run after it, and
// which ones depends on how the machine splits the work. That is how the English
// expectations of a spec failed on CI and passed here. Every test starts empty.
beforeEach(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // storage blocked in this environment: nothing to clear
  }
});

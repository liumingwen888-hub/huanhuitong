module.exports = {
  forbidden: [
    {
      name: 'no-domain-to-telegram',
      severity: 'error',
      from: { path: '^apps/platform/(src|dist)/modules/(identity|reliability)/' },
      to: { path: '^apps/platform/(src|dist)/modules/telegram/' }
    },
    {
      name: 'no-packages-to-apps',
      severity: 'error',
      from: { path: '^packages/(config|contracts|testing)/(src|dist)/' },
      to: { path: '^apps/' }
    },
    {
      name: 'no-worker-to-platform-internals',
      severity: 'error',
      from: { path: '^apps/worker/(src|dist)/' },
      to: { path: '^apps/platform/' }
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true }
    }
  ],
  options: { tsPreCompilationDeps: true, doNotFollow: { path: 'node_modules' } }
};

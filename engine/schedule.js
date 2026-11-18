// Shared chat-block scheduler. Loaded as a plain script in comp.html and require()d by timing.mjs,
// so the browser and the timing builder agree on how long a chat scene needs.
(function (root) {
  const CPS_TYPE = 34, CPS_STREAM = 48, GAP = 0.5;
  const len = (s) => (s || '').replace(/`/g, '').length;
  /** Lay out one chat scene's blocks from `start`. Returns [{...block, at, end, times}] */
  function scheduleBlocks(blocks, start) {
    let t = start; const out = [];
    for (const b of blocks) {
      const at = t + (b.pause || 0); const x = { ...b, at };
      if (b.type === 'user') {
        if (b.typed === false) { x.sendAt = at + 0.1; x.end = at + 0.5; }
        else { x.typeAt = at + 0.1; x.sendAt = x.typeAt + len(b.text) / CPS_TYPE + 0.25; x.end = x.sendAt + 0.2; }
      } else if (b.type === 'ai') {
        x.showAt = at + 0.45; x.doneAt = at + 0.45 + (b.run || 0.9); x.leadAt = x.doneAt + 0.15;
        let p = x.leadAt + len(b.lead) / CPS_STREAM;
        x.items = [];
        const n = (b.bullets || b.checks || b.rows || b.artefacts || []).length;
        if (n) { x.itemsAt = p + 0.3; x.items = Array.from({ length: n }, (_, i) => x.itemsAt + (b.rows ? 0.3 : 0.4) * i); p = x.itemsAt + (b.rows ? 0.3 : 0.4) * n + 0.2; }
        if (b.code) { x.codeAt = p + 0.3; p = x.codeAt + 0.6; }
        if (b.okbox) { x.okAt = p + 0.3; p = x.okAt + 0.6; }
        if (b.rel) { x.relAt = p + 0.4; p = x.relAt + 0.6; }
        if (b.paste) { x.pasteAt = p + 0.4; p = x.pasteAt + 1.1 * b.paste.length + 0.3; }
        if (b.doc) { x.docAt = p + 0.4; p = x.docAt + 0.8; }
        if (b.next) { x.nextAt = p + 0.3; p = x.nextAt + len(b.next) / CPS_STREAM; }
        if (b.card) { x.cardAt = p + 0.9; p = x.cardAt + 0.8; }
        x.end = p + 0.2;
      } else if (b.type === 'approve') {
        // cursor to transport picker (if select), click; cursor to Approve, click; applying; applied
        const sel = b.select !== false;
        x.selAt = sel ? at + 1.4 : null; x.clickAt = at + (sel ? 3.05 : 1.6); x.applyingAt = x.clickAt + 0.15; x.appliedAt = x.applyingAt + 1.6; x.end = x.appliedAt + 0.6;
      } else if (b.type === 'release') {
        // human two-step on the release card: click Release…, confirm panel, click Release transport, released banner
        x.openAt = at + 1.2; x.confirmAt = at + 3.4; x.releasedAt = x.confirmAt + 1.2; x.end = x.releasedAt + 0.6;
      } else { x.end = at + 0.5; }
      out.push(x); t = x.end + GAP;
    }
    return out;
  }
  /** Seconds a chat scene needs to show all its blocks. */
  function chatDuration(blocks) { const s = scheduleBlocks(blocks, 0); return s.length ? s[s.length - 1].end : 0; }
  const api = { scheduleBlocks, chatDuration, CPS_TYPE, CPS_STREAM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SCHED = api;
})(typeof window !== 'undefined' ? window : globalThis);

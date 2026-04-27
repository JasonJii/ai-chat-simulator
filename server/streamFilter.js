/**
 * 流式输出时隐藏 STATE_JSON 行，避免用户看到机器字段
 */
export class VisibleStreamFilter {
  constructor(onVisible) {
    this.full = "";
    this.onVisible = onVisible;
    this.visEmitted = 0;
  }

  /** @param {string} chunk 模型增量原文 */
  push(chunk) {
    this.full += chunk;
    const cut = this.full.indexOf("STATE_JSON:");
    const visEnd = cut === -1 ? this.full.length : cut;
    if (visEnd > this.visEmitted) {
      const piece = this.full.slice(this.visEmitted, visEnd);
      this.visEmitted = visEnd;
      if (piece) this.onVisible(piece);
    }
  }

  raw() {
    return this.full;
  }
}

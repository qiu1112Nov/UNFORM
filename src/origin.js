// Navigation owns no artwork: returning to ORIGIN keeps the same CREATE session.
export class OriginFlow {
  constructor({ render, enter, leave, hasChanges, confirmReturn }) {
    this.screen = 'ORIGIN'; this.started = false; this.path = 'GEOMETRY'; this.fusionStarted = false;
    Object.assign(this, { render, enter, leave, hasChanges, confirmReturn });
    this.render(this.screen);
  }
  choose(path) {
    if (this.screen !== 'ORIGIN') return false;
    if (path === 'FUSION') { this.screen = 'IMPORT'; this.render(this.screen); return true; }
    if (path !== 'GEOMETRY') return false;
    this.path = 'GEOMETRY'; this.screen = 'CREATE'; this.render(this.screen);
    this.enter(!this.started, this.path); this.started = true;
    return true;
  }
  back() {
    if (this.screen === 'IMPORT' || this.screen === 'TRANSLATE') {
      this.screen = 'ORIGIN'; this.render(this.screen); return true;
    }
    if (this.screen !== 'CREATE') return false;
    if (this.hasChanges() && !this.confirmReturn()) return false;
    this.leave(); this.screen = 'ORIGIN'; this.render(this.screen);
    return true;
  }
  translate(ready) {
    if (this.screen !== 'IMPORT' || !ready) return false;
    this.screen = 'TRANSLATE'; this.render(this.screen); return true;
  }
  resumeFusion() {
    if (this.screen !== 'ORIGIN' || !this.fusionStarted) return false;
    this.path = 'FUSION'; this.screen = 'CREATE'; this.render(this.screen);
    this.enter(false, this.path); return true;
  }
  createFusion(material) {
    if (this.screen !== 'TRANSLATE' || !material) return false;
    this.fusionStarted = true; this.path = 'FUSION'; this.screen = 'CREATE'; this.render(this.screen);
    this.enter(!this.started, this.path, material); this.started = true; return true;
  }
  editImage() {
    if (this.screen !== 'TRANSLATE') return false;
    this.screen = 'IMPORT'; this.render(this.screen); return true;
  }
}

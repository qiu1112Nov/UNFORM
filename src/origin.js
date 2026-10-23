// Navigation owns no artwork: returning to ORIGIN keeps the same CREATE session.
export class OriginFlow {
  constructor({ render, enter, leave, hasChanges, confirmReturn }) {
    this.screen = 'ORIGIN'; this.started = false;
    Object.assign(this, { render, enter, leave, hasChanges, confirmReturn });
    this.render(this.screen);
  }
  choose(path) {
    if (path !== 'GEOMETRY' || this.screen !== 'ORIGIN') return false;
    this.screen = 'CREATE'; this.render(this.screen);
    this.enter(!this.started); this.started = true;
    return true;
  }
  back() {
    if (this.screen !== 'CREATE') return false;
    if (this.hasChanges() && !this.confirmReturn()) return false;
    this.leave(); this.screen = 'ORIGIN'; this.render(this.screen);
    return true;
  }
}

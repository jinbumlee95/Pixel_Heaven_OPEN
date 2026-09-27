import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../state/worldState.js';

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.width = 1; this.height = 1; }
  resize(widthPixels, heightPixels) {
    const focus={x:this.x+this.width/2,y:this.y+this.height/2};
    this.width = Math.min(MAP_WIDTH, widthPixels / TILE_SIZE);
    this.height = Math.min(MAP_HEIGHT, heightPixels / TILE_SIZE);
    this.center(focus);
  }
  pan(dx, dy) {
    this.x = Math.max(0, Math.min(MAP_WIDTH - this.width, this.x + dx));
    this.y = Math.max(0, Math.min(MAP_HEIGHT - this.height, this.y + dy));
  }
  center(position) {
    this.x = position.x - this.width / 2;
    this.y = position.y - this.height / 2;
    this.pan(0, 0);
  }
  get bounds() {
    return { left: Math.floor(this.x), top: Math.floor(this.y),
      right: Math.min(MAP_WIDTH, Math.ceil(this.x + this.width)),
      bottom: Math.min(MAP_HEIGHT, Math.ceil(this.y + this.height)) };
  }
}

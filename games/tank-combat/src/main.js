import { Game } from './game/Game.js';

const app = document.getElementById('app');
const hudRoot = document.getElementById('hud');
const boot = document.getElementById('boot');

// let the loading screen paint before the (synchronous) world build
requestAnimationFrame(() => setTimeout(() => {
  const game = new Game(app, hudRoot);
  window.game = game; // handy for the console and later stages
  boot.remove();
  game.start();
}, 30));

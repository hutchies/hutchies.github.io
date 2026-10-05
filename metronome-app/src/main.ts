import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

export default mount(App, { target: document.getElementById('app')! });

if (import.meta.env.DEV) {
  // Handy for debugging and for the browser smoke test.
  import('./lib/state/app.svelte').then(({ app }) => ((window as unknown as { app: unknown }).app = app));
}

// Installable and offline (see sw/sw.js). Not in dev, where it would cache stale modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

/**
 * The client entry point.
 *
 * WAS a dev harness rendering five static board states with a width slider. NOW
 * it renders the application, wired to the live server through `net/`.
 *
 * THE HARNESS IS NOT DELETED. `board/BoardHarness.tsx` is somebody else's file
 * and is still the fastest way to eyeball the §4.6 matrix across all seventy
 * cells without a server, so it stays on disk and stays importable — the board's
 * own `board.render.test.tsx` still drives it. What changed is only which one
 * the page boots, because a page that renders a static board is not a game.
 *
 * `StrictMode` is kept. It double-mounts effects in development, which is
 * exactly the pressure that makes an effect that opens a socket twice obvious —
 * and `Connection.connect` is written to be idempotent for that reason.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './theme/tokens.css';

import { App } from './app/App.tsx';

const host = document.getElementById('root');
if (host === null) throw new Error('#root missing from index.html');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

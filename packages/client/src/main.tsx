import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import { BoardHarness } from './board/BoardHarness';

const host = document.getElementById('root');
if (host === null) throw new Error('#root missing from index.html');

createRoot(host).render(
  <StrictMode>
    <BoardHarness />
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('ROOT_ELEMENT_MISSING');
}
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);

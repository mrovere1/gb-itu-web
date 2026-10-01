import { CONFIG } from './config.js?v=bc1935048e';

// A ligação das peças entra no Task 4.
export const ready = CONFIG.idleLogoutMs > 0;

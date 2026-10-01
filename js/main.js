import { CONFIG } from './config.js?v=58f8e4fd52';

// A ligação das peças entra no Task 4.
export const ready = CONFIG.idleLogoutMs > 0;

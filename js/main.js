import { CONFIG } from './config.js?v=e8e7804d79';

// A ligação das peças entra no Task 4.
export const ready = CONFIG.idleLogoutMs > 0;

import { io } from 'socket.io-client';
// Same server serves the app in production (Render), so same-origin just works.
// Local `vite dev` on :5173 still talks to the dev API on :3001.
// Override with VITE_SERVER=http://host:port if your setup differs.
const isDev = typeof window !== 'undefined' && window.location.port === '5173';
const URL = import.meta.env.VITE_SERVER || (isDev ? 'http://localhost:3001' : window.location.origin);
export const socket = io(URL, { autoConnect: true });
export const SERVER_URL = URL;

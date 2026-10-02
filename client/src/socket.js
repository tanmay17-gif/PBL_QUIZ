import { io } from 'socket.io-client';
const URL = import.meta.env.VITE_SERVER || 'http://localhost:3001';
export const socket = io(URL, { autoConnect: true });
export const SERVER_URL = URL;

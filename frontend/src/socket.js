import { io } from 'socket.io-client';

// เชื่อมต่อผ่าน path เดียวกับหน้าเว็บ (nginx จะพร็อกซี /socket.io ไปที่ backend ให้)
const socket = io({ autoConnect: true, transports: ['websocket', 'polling'] });

export default socket;

import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import dotenv from 'dotenv';
import { prisma } from './db';

dotenv.config();

const QueueStatus = {
  WAITING: 'WAITING',
  CALLING: 'CALLING',
  SKIPPED: 'SKIPPED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

const QueueType = {
  WALK_IN: 'WALK_IN',
  BOOKING: 'BOOKING',
} as const;

const readyQueueFilter = {
  OR: [
    { queueType: { not: QueueType.BOOKING } },
    { isCheckedIn: true },
  ],
};

const adminQueueFilter = {
  OR: [
    { status: { not: QueueStatus.WAITING } },
    readyQueueFilter,
    { bookingExpired: true },
  ],
};

const app = express();
const PORT = process.env.PORT || 4000;
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost';
const ADMIN_DEFAULT_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'denla2026';

async function ensureDefaultAdminUser() {
  const existing = await prisma.adminUser.findFirst();
  if (existing) return;

  await prisma.adminUser.create({
    data: {
      username: ADMIN_DEFAULT_USERNAME,
      password: ADMIN_DEFAULT_PASSWORD,
      role: 'ADMIN',
    },
  });
}

async function ensureDefaultSettings() {
  const defaults = [
    { key: 'siteTitle', value: 'DENLA RAMA 5 | จองคิวธุรการ' },
    { key: 'siteSubtitle', value: 'จองคิวติดต่อธุรการ' },
  ];

  for (const item of defaults) {
    const existing = await prisma.setting.findUnique({ where: { key: item.key } });
    if (!existing) {
      await prisma.setting.create({ data: item });
    }
  }
}

async function initializeDatabaseDefaults() {
  await ensureDefaultAdminUser();
  await ensureDefaultSettings();
  await backfillMissingQueueDates();
}

void initializeDatabaseDefaults().catch((err) => {
  console.error('[Database] initialize error', err);
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});

// ---------------------------------------------------------------------------
// Nodemailer transporter
// ---------------------------------------------------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail(to: string, subject: string, html: string) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"โรงเรียน (School Queue)" <no-reply@school.local>',
      to,
      subject,
      html,
    });
  } catch (err) {
    // ไม่ throw ต่อ เพราะการส่งอีเมลไม่ควรทำให้การจองคิวล้มเหลว
    console.error('[Mailer] ส่งอีเมลไม่สำเร็จ:', err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resolveFrontendBaseUrl(req?: any) {
  const envBaseUrl = process.env.FRONTEND_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:5173';
  if (!req) return envBaseUrl;

  const origin = req.headers?.origin;
  if (typeof origin === 'string' && origin) return origin;

  const forwardedProto = req.headers?.['x-forwarded-proto'];
  const forwardedHost = req.headers?.['x-forwarded-host'];
  if (typeof forwardedProto === 'string' && typeof forwardedHost === 'string') {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = req.get?.('host');
  if (host) {
    const protocol = req.secure || req.protocol === 'https' ? 'https' : 'http';
    return `${protocol}://${host}`;
  }

  return envBaseUrl;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function sameDayStart(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sameDayEnd(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseDateOnly(dateString: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) return null;

  date.setHours(0, 0, 0, 0);
  return date;
}

function queueDateFilter(date: Date = startOfToday()) {
  return {
    OR: [
      { bookingDate: date },
      {
        AND: [
          { bookingDate: null },
          { createdAt: { gte: sameDayStart(date), lt: sameDayEnd(date) } },
        ],
      },
    ],
  };
}

function serviceDayFilter(date: Date = startOfToday()) {
  return {
    OR: [
      { queueType: QueueType.BOOKING, bookingDate: date },
      { queueType: { not: QueueType.BOOKING }, createdAt: { gte: sameDayStart(date), lt: sameDayEnd(date) } },
    ],
  };
}

function combineFilters(...filters: Record<string, unknown>[]) {
  return { AND: filters };
}

function isQueueForToday(queue: { queueType: string; bookingDate: Date | null; createdAt: Date }) {
  if (queue.queueType === QueueType.BOOKING) {
    return Boolean(queue.bookingDate && sameDayStart(new Date(queue.bookingDate)).getTime() === startOfToday().getTime());
  }
  return new Date(queue.createdAt) >= startOfToday();
}

function slotEndDate(queue: { bookingDate: Date | null; timeSlot?: { endTime: string } | null }) {
  if (!queue.bookingDate || !queue.timeSlot?.endTime) return null;
  const [hours, minutes] = queue.timeSlot.endTime.split(':').map(Number);
  const end = new Date(queue.bookingDate);
  end.setHours(hours || 0, minutes || 0, 0, 0);
  return end;
}

async function expireOverdueBookings() {
  const candidates = await prisma.queue.findMany({
    where: {
      queueType: QueueType.BOOKING,
      status: { notIn: [QueueStatus.COMPLETED, QueueStatus.CANCELLED] },
      bookingDate: { not: null },
    },
    include: { timeSlot: true },
  });

  const now = new Date();
  const todayStart = startOfToday();

  // Past-day bookings (any status excl. COMPLETED/CANCELLED) → auto CANCELLED
  const toCancelIds: number[] = [];
  // Today: not checked-in AND past startTime + 5-min grace → SKIPPED (admin can restore)
  const toSkipIds: number[] = [];

  for (const queue of candidates) {
    const bookingDay = queue.bookingDate ? sameDayStart(new Date(queue.bookingDate)) : null;
    if (!bookingDay) continue;

    // ถ้าเลยวันจอง → CANCELLED อัตโนมัติ
    if (bookingDay < todayStart) {
      toCancelIds.push(queue.id);
      continue;
    }

    // ยังไม่ Check-in → ตรวจ late-arrival
    if (!queue.isCheckedIn && queue.status === QueueStatus.WAITING && queue.timeSlot?.startTime) {
      const [h, m] = queue.timeSlot.startTime.split(':').map(Number);
      const slotStart = new Date(queue.bookingDate!);
      slotStart.setHours(h, m, 0, 0);
      // Grace period 5 นาที หลัง startTime
      const graceEnd = new Date(slotStart.getTime() + 5 * 60 * 1000);
      if (now > graceEnd) {
        toSkipIds.push(queue.id);
      }
    }
  }

  if (toCancelIds.length > 0) {
    await prisma.queue.updateMany({
      where: { id: { in: toCancelIds }, status: { notIn: [QueueStatus.COMPLETED, QueueStatus.CANCELLED] } },
      data: { status: QueueStatus.CANCELLED, bookingExpired: true },
    });
    for (const id of toCancelIds) {
      const q = candidates.find((c) => c.id === id);
      if (q) io.emit('queue:updated', { ...q, status: QueueStatus.CANCELLED, bookingExpired: true });
    }
  }

  if (toSkipIds.length > 0) {
    await prisma.queue.updateMany({
      where: { id: { in: toSkipIds }, status: { notIn: [QueueStatus.COMPLETED, QueueStatus.CANCELLED] } },
      data: { status: QueueStatus.SKIPPED, bookingExpired: true },
    });
    for (const id of toSkipIds) {
      const q = candidates.find((c) => c.id === id);
      if (q) io.emit('queue:updated', { ...q, status: QueueStatus.SKIPPED, bookingExpired: true });
    }
  }

  if (toCancelIds.length > 0 || toSkipIds.length > 0) {
    io.emit('dashboard:update');
  }
}


async function backfillMissingQueueDates() {
  const missing = await prisma.queue.findMany({
    where: { bookingDate: null },
    select: { id: true, createdAt: true },
  });

  for (const queue of missing) {
    const normalized = sameDayStart(new Date(queue.createdAt));
    await prisma.queue.update({
      where: { id: queue.id },
      data: { bookingDate: normalized },
    });
  }
}

async function resolveUniqueServicePrefix(basePrefix: string, currentServiceId?: number) {
  const cleaned = (basePrefix || 'SV').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'SV';
  const existing = await prisma.service.findMany({
    where: currentServiceId ? { NOT: { id: currentServiceId } } : {},
    select: { prefix: true },
  });
  const used = new Set(existing.map((item) => item.prefix.toUpperCase()));

  let candidate = cleaned;
  let suffix = 1;
  while (used.has(candidate)) {
    candidate = `${cleaned}${suffix}`;
    suffix += 1;
  }

  return candidate;
}

/** สร้างเลขคิววิ่งต่อ service ต่อวัน เช่น A-001, A-002 */
async function generateTicketNo(serviceId: number, prefix: string, bDate: Date) {
  const count = await prisma.queue.count({
    where: { serviceId, bookingDate: bDate },
  });
  return `${prefix}-${String(count + 1).padStart(3, '0')}`;
}

function ticketSequence(ticketNo: string) {
  const parts = ticketNo.split('-');
  return Number(parts[1] || 0);
}

/**
 * เรียงคิว WAITING ตาม Priority Rule เดียวกับ pickNextQueue:
 *   1. BOOKING ที่ isCheckedIn=true AND slot เริ่มแล้ว → เรียง [slotStartTime ASC, checkedInAt ASC]
 *   2. WALK_IN → เรียง [id ASC]
 *   3. BOOKING ที่ isCheckedIn=true แต่ slot ยังไม่เริ่ม → เรียง [slotStartTime ASC, checkedInAt ASC]
 *   4. คิวอื่นๆ → เรียง id ASC
 */
function sortByPriority<T extends {
  id: number;
  queueType: string;
  status: string;
  isCheckedIn: boolean;
  checkedInAt: Date | null;
  bookingDate: Date | null;
  timeSlot?: { startTime: string } | null;
}>(queues: T[], now: Date = new Date()): T[] {
  const WALK_IN = 'WALK_IN';
  const BOOKING = 'BOOKING';

  const getSlotStart = (q: T): Date | null => {
    if (!q.bookingDate || !q.timeSlot?.startTime) return null;
    const [h, m] = q.timeSlot.startTime.split(':').map(Number);
    const d = new Date(q.bookingDate);
    d.setHours(h, m, 0, 0);
    return d;
  };

  return [...queues].sort((a, b) => {
    const aSlotStart = getSlotStart(a);
    const bSlotStart = getSlotStart(b);
    const aSlotReady = a.queueType === BOOKING && a.isCheckedIn && aSlotStart !== null && now >= aSlotStart;
    const bSlotReady = b.queueType === BOOKING && b.isCheckedIn && bSlotStart !== null && now >= bSlotStart;
    const aIsWalkIn = a.queueType === WALK_IN;
    const bIsWalkIn = b.queueType === WALK_IN;

    // Priority bucket: 0=ready Booking, 1=Walk-in, 2=pending Booking, 3=อื่นๆ
    const bucket = (q: T, slotReady: boolean, isWalkIn: boolean) => {
      if (slotReady) return 0;
      if (isWalkIn) return 1;
      if (q.queueType === BOOKING && q.isCheckedIn) return 2;
      return 3;
    };

    const aBucket = bucket(a, aSlotReady, aIsWalkIn);
    const bBucket = bucket(b, bSlotReady, bIsWalkIn);

    if (aBucket !== bBucket) return aBucket - bBucket;

    // ภายใน bucket 0 และ 2 (Booking): เรียงด้วย slot startTime → checkedInAt
    if (aBucket === 0 || aBucket === 2) {
      const aSlot = a.timeSlot?.startTime ?? '99:99';
      const bSlot = b.timeSlot?.startTime ?? '99:99';
      if (aSlot !== bSlot) return aSlot.localeCompare(bSlot);
      return (a.checkedInAt?.getTime() ?? a.id) - (b.checkedInAt?.getTime() ?? b.id);
    }

    // ภายใน bucket 1 (Walk-in): เรียงด้วย id
    return a.id - b.id;
  });
}

/** กระจายสถานะคิวปัจจุบันของ service ให้ทั้งฝั่ง Admin (ห้องเฉพาะ) และจอ Display (broadcast) */
async function broadcastServiceState(serviceId: number) {
  const queues = await prisma.queue.findMany({
    where: { serviceId, ...combineFilters(readyQueueFilter, queueDateFilter()) },
    orderBy: { id: 'asc' },
    include: { timeSlot: true },
  });
  // ส่งคิวเรียงตาม priority จริง
  io.to(`service:${serviceId}`).emit('queue:board', sortByPriority(queues));
  io.emit('dashboard:update');
  io.emit('display:update');
}


function emitQueueCalled(queue: Record<string, unknown>) {
  const eventId = `queue-call-${queue.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  io.emit('queue:called', { ...queue, eventId });
}

/**
 * ตรวจสอบว่า slot ของ Booking เริ่มแล้วหรือยัง (slotStart <= now)
 */
function isSlotStarted(bookingDate: Date, startTime: string, now: Date = new Date()): boolean {
  const [h, m] = startTime.split(':').map(Number);
  const slotStart = new Date(bookingDate);
  slotStart.setHours(h, m, 0, 0);
  return now >= slotStart;
}

/**
 * เลือก "คิวถัดไป" ตาม Priority Rule:
 *   Priority 1: BOOKING ที่ isCheckedIn=true AND slot เริ่มแล้ว (slotStart <= now)
 *               → เรียงด้วย [slotStartTime ASC, checkedInAt ASC] (ใครจองรอบแรกและมาก่อน ได้ก่อน)
 *   Priority 2: WALK_IN WAITING (เรียง id ASC)
 */
async function pickNextQueue(serviceIds: number[]) {
  const now = new Date();
  const serviceFilter = serviceIds.length > 0 ? { serviceId: { in: serviceIds } } : {};

  // --- Priority 1: Booking ที่ checked-in และถึงรอบแล้ว ---
  const checkedInBookings = await prisma.queue.findMany({
    where: {
      ...serviceFilter,
      status: QueueStatus.WAITING,
      queueType: QueueType.BOOKING,
      isCheckedIn: true,
      ...queueDateFilter(),
    },
    include: { timeSlot: true },
  });

  const readyBookings = checkedInBookings.filter(
    (q) => q.bookingDate && q.timeSlot?.startTime && isSlotStarted(new Date(q.bookingDate), q.timeSlot.startTime, now)
  );

  if (readyBookings.length > 0) {
    readyBookings.sort((a, b) => {
      // เรียง slot ก่อน (รอบแรก ได้ก่อน)
      const aSlot = a.timeSlot?.startTime ?? '99:99';
      const bSlot = b.timeSlot?.startTime ?? '99:99';
      if (aSlot !== bSlot) return aSlot.localeCompare(bSlot);
      // ภายใน slot เดียวกัน เรียงตาม checkedInAt (ใคร check-in ก่อน ได้ก่อน)
      return (a.checkedInAt?.getTime() ?? a.id) - (b.checkedInAt?.getTime() ?? b.id);
    });
    return readyBookings[0];
  }

  // --- Priority 2: Walk-in ---
  return prisma.queue.findFirst({
    where: {
      ...serviceFilter,
      status: QueueStatus.WAITING,
      queueType: QueueType.WALK_IN,
      ...queueDateFilter(),
    },
    orderBy: { id: 'asc' },
  });
}

/**
 * Logic หลัก: หา "คิวปัจจุบัน" ของ service (คิวที่กำลัง CALLING หรือคิวล่าสุดที่ COMPLETED)
 * แล้วเช็คว่าคิว WAITING ใดที่ "current - user <= 2" และยังไม่เคยแจ้งเตือน -> ส่งอีเมลแจ้งเตือน 1 ครั้ง
 */
async function checkAndNotifyUpcoming(serviceId: number, baseUrl: string) {
  const calling = await prisma.queue.findFirst({
    where: { serviceId, status: QueueStatus.CALLING, bookingDate: startOfToday() },
    orderBy: { id: 'desc' },
  });

  let currentNumber = 0;
  if (calling) {
    currentNumber = ticketSequence(calling.ticketNo);
  } else {
    const lastCompleted = await prisma.queue.findFirst({
      where: { serviceId, status: QueueStatus.COMPLETED, bookingDate: startOfToday() },
      orderBy: { id: 'desc' },
    });
    currentNumber = lastCompleted ? ticketSequence(lastCompleted.ticketNo) : 0;
  }

  const waiting = await prisma.queue.findMany({
    where: {
      serviceId,
      status: QueueStatus.WAITING,
      isEmailNotified: false,
      ...combineFilters(readyQueueFilter, queueDateFilter()),
    },
  });

  for (const q of waiting) {
    const diff = ticketSequence(q.ticketNo) - currentNumber;
    if (diff >= 0 && diff <= 2) {
      const trackUrl = `${baseUrl}/track/${q.id}`;
      await sendMail(
        q.userEmail,
        `ใกล้ถึงคิวของท่านแล้ว (${q.ticketNo})`,
        `<p>เรียน ${q.userName}</p>
         <p>คิวหมายเลข <b>${q.ticketNo}</b> ของท่านใกล้ถึงคิวแล้ว (เหลืออีกไม่เกิน 2 คิว)
         กรุณาเตรียมตัวมาที่จุดบริการ</p>
         <p>ติดตามสถานะคิวแบบเรียลไทม์ได้ที่: <a href="${trackUrl}">${trackUrl}</a></p>`
      );
      await prisma.queue.update({ where: { id: q.id }, data: { isEmailNotified: true } });
      io.to(`queue:${q.id}`).emit('queue:almost-your-turn', q);
    }
  }
}

// ---------------------------------------------------------------------------
// Health / fallback routes
// ---------------------------------------------------------------------------
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    message: 'School Queue API is running',
    endpoints: ['/api/services', '/api/queues', '/api/admin/queues', '/api/display'],
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'healthy' });
});

// ---------------------------------------------------------------------------
// Routes: Services
// ---------------------------------------------------------------------------
app.get('/api/services', async (_req, res) => {
  const services = await prisma.service.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  res.json(services);
});

app.patch('/api/services/reorder', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  await prisma.$transaction(
    items.map((item: { id: number; sortOrder: number }) =>
      prisma.service.update({ where: { id: Number(item.id) }, data: { sortOrder: Number(item.sortOrder) } })
    )
  );
  res.json({ ok: true });
});

app.post('/api/services', async (req, res) => {
  const { name, nameEn, description, descriptionEn, prefix, icon, iconName } = req.body;
  try {
    if (icon && !/^data:image\//i.test(String(icon))) {
      return res.status(400).json({ error: 'กรุณาอัปโหลดรูปภาพประเภทบริการ' });
    }
    const finalPrefix = await resolveUniqueServicePrefix(prefix || name || 'SV');
    const service = await prisma.service.create({
      data: {
        name,
        nameEn: nameEn || null,
        description: description || null,
        descriptionEn: descriptionEn || null,
        prefix: finalPrefix,
        icon: icon || null,
        iconName: iconName || null,
      },
    });
    res.status(201).json(service);
  } catch (err) {
    console.error('[Services] create error', err);
    res.status(400).json({ error: 'ไม่สามารถเพิ่มประเภทบริการได้' });
  }
});

app.patch('/api/services/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, nameEn, description, descriptionEn, prefix, icon, iconName } = req.body;
  if (icon !== undefined && icon !== null && String(icon).trim() && !/^data:image\//i.test(String(icon))) {
    return res.status(400).json({ error: 'กรุณาอัปโหลดรูปภาพประเภทบริการ' });
  }
  const current = await prisma.service.findUnique({ where: { id }, select: { prefix: true } });
  const finalPrefix = await resolveUniqueServicePrefix(prefix || current?.prefix || 'SV', id);
  const service = await prisma.service.update({
    where: { id },
    data: {
      ...(name ? { name } : {}),
      ...(nameEn !== undefined ? { nameEn: nameEn || null } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
      ...(descriptionEn !== undefined ? { descriptionEn: descriptionEn || null } : {}),
      prefix: finalPrefix,
      ...(icon !== undefined ? { icon: icon || null } : {}),
      ...(iconName !== undefined ? { iconName: iconName || null } : {}),
    },
  });
  res.json(service);
});

app.delete('/api/services/:id', async (req, res) => {
  const id = Number(req.params.id);

  const activeQueueCount = await prisma.queue.count({
    where: { serviceId: id, status: { in: [QueueStatus.WAITING, QueueStatus.CALLING] } },
  });
  if (activeQueueCount > 0) {
    return res.status(400).json({
      error: 'ไม่สามารถลบประเภทบริการได้ เนื่องจากมีคิวที่กำลังรอหรือกำลังให้บริการอยู่',
    });
  }

  await prisma.counter.updateMany({ where: { serviceId: id }, data: { serviceId: null } });
  await prisma.service.delete({ where: { id } });
  res.json({ ok: true });
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await prisma.adminUser.findUnique({ where: { username } });
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/admin/users', async (_req, res) => {
  const users = await prisma.adminUser.findMany({ orderBy: { id: 'asc' } });
  res.json(users);
});

app.post('/api/admin/users', async (req, res) => {
  const { username, password, role } = req.body;
  const user = await prisma.adminUser.create({ data: { username, password, role: role || 'ADMIN' } });
  res.status(201).json(user);
});

app.patch('/api/admin/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { username, password, role } = req.body;
  const user = await prisma.adminUser.update({
    where: { id },
    data: { ...(username ? { username } : {}), ...(password ? { password } : {}), ...(role ? { role } : {}) },
  });
  res.json(user);
});

app.delete('/api/admin/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  await prisma.adminUser.delete({ where: { id } });
  res.json({ ok: true });
});

app.get('/api/admin/settings', async (_req, res) => {
  const settings = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
  res.json(settings);
});

app.post('/api/admin/settings', async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'กรุณาระบุชื่อการตั้งค่า' });
  const setting = await prisma.setting.upsert({
    where: { key },
    update: { value: String(value ?? '') },
    create: { key, value: String(value ?? '') },
  });
  io.emit('settings:updated', setting);
  res.json(setting);
});

app.get('/api/contact-subjects', async (req, res) => {
  const serviceId = req.query.serviceId ? Number(req.query.serviceId) : undefined;
  const subjects = await prisma.contactSubject.findMany({
    where: { isActive: true, ...(serviceId ? { serviceId } : {}) },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  res.json(subjects);
});

app.get('/api/admin/contact-subjects', async (_req, res) => {
  const subjects = await prisma.contactSubject.findMany({
    orderBy: [{ serviceId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    include: { service: true },
  });
  res.json(subjects);
});

app.post('/api/admin/contact-subjects', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const nameEn = String(req.body?.nameEn || '').trim();
  const serviceId = Number(req.body?.serviceId);
  if (!name || !serviceId) return res.status(400).json({ error: 'กรุณากรอกเรื่องและเลือกประเภทบริการ' });
  const existing = await prisma.contactSubject.findFirst({ where: { name, serviceId } });
  if (existing) return res.status(400).json({ error: 'เรื่องนี้มีอยู่ในประเภทบริการแล้ว' });
  const subject = await prisma.contactSubject.create({
    data: { name, nameEn: nameEn || null, serviceId, sortOrder: Number(req.body?.sortOrder || 0) },
    include: { service: true },
  });
  res.status(201).json(subject);
});

app.patch('/api/admin/contact-subjects/reorder', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  await prisma.$transaction(
    items.map((item: { id: number; sortOrder: number }) =>
      prisma.contactSubject.update({ where: { id: Number(item.id) }, data: { sortOrder: Number(item.sortOrder) } })
    )
  );
  res.json({ ok: true });
});

app.patch('/api/admin/contact-subjects/:id', async (req, res) => {
  const id = Number(req.params.id);
  const data: { name?: string; nameEn?: string | null; serviceId?: number; sortOrder?: number; isActive?: boolean } = {};
  if (req.body?.name !== undefined) data.name = String(req.body.name).trim();
  if (req.body?.nameEn !== undefined) data.nameEn = String(req.body.nameEn).trim() || null;
  if (req.body?.serviceId !== undefined) data.serviceId = Number(req.body.serviceId);
  if (req.body?.sortOrder !== undefined) data.sortOrder = Number(req.body.sortOrder);
  if (typeof req.body?.isActive === 'boolean') data.isActive = req.body.isActive;
  const subject = await prisma.contactSubject.update({ where: { id }, data, include: { service: true } });
  res.json(subject);
});

app.delete('/api/admin/contact-subjects/:id', async (req, res) => {
  await prisma.contactSubject.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

app.get('/api/admin/counters', async (_req, res) => {
  const counters = await prisma.counter.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { service: true } });
  res.json(counters);
});

app.patch('/api/admin/counters/reorder', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  await prisma.$transaction(
    items.map((item: { id: number; sortOrder: number }) =>
      prisma.counter.update({ where: { id: Number(item.id) }, data: { sortOrder: Number(item.sortOrder) } })
    )
  );
  res.json({ ok: true });
});

app.post('/api/admin/counters', async (req, res) => {
  const { name, isActive, serviceId } = req.body;
  const trimmedName = String(name || '').trim();
  const parsedServiceId = serviceId === undefined || serviceId === null || serviceId === '' ? null : Number(serviceId);

  if (!trimmedName) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อช่องบริการ' });
  }
  if (!parsedServiceId) {
    return res.status(400).json({ error: 'กรุณาเลือกประเภทบริการก่อนบันทึก' });
  }

  const service = await prisma.service.findUnique({ where: { id: parsedServiceId } });
  if (!service) {
    return res.status(404).json({ error: 'ไม่พบประเภทบริการที่เลือก' });
  }

  const counter = await prisma.counter.create({
    data: {
      name: trimmedName,
      isActive: isActive ?? true,
      serviceId: parsedServiceId,
    },
    include: { service: true },
  });
  res.status(201).json(counter);
});

app.patch('/api/admin/counters/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, isActive, serviceId } = req.body;
  const trimmedName = name === undefined ? undefined : String(name).trim();
  const parsedServiceId = serviceId === undefined || serviceId === null || serviceId === '' ? null : Number(serviceId);

  if (trimmedName !== undefined && !trimmedName) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อช่องบริการ' });
  }

  if (serviceId !== undefined && !parsedServiceId) {
    return res.status(400).json({ error: 'กรุณาเลือกประเภทบริการก่อนบันทึก' });
  }

  if (parsedServiceId) {
    const service = await prisma.service.findUnique({ where: { id: parsedServiceId } });
    if (!service) {
      return res.status(404).json({ error: 'ไม่พบประเภทบริการที่เลือก' });
    }
  }

  const counter = await prisma.counter.update({
    where: { id },
    data: {
      ...(trimmedName !== undefined ? { name: trimmedName } : {}),
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
      ...(serviceId !== undefined ? { serviceId: parsedServiceId } : {}),
    },
    include: { service: true },
  });
  res.json(counter);
});

app.delete('/api/admin/counters/:id', async (req, res) => {
  const id = Number(req.params.id);
  await prisma.counter.delete({ where: { id } });
  res.json({ ok: true });
});


// ---------------------------------------------------------------------------
// Routes: Time Slots
// ---------------------------------------------------------------------------
app.get('/api/admin/time-slots', async (req, res) => {
  const slots = await prisma.timeSlot.findMany({ orderBy: { startTime: 'asc' } });
  res.json(slots);
});

app.post('/api/admin/time-slots', async (req, res) => {
  const { startTime, endTime, capacity, isActive } = req.body;
  if (!startTime || !endTime) return res.status(400).json({ error: 'Start and end time are required' });
  const slot = await prisma.timeSlot.create({
    data: { startTime, endTime, capacity: Number(capacity) || 10, isActive: typeof isActive === 'boolean' ? isActive : true }
  });
  res.json(slot);
});

app.put('/api/admin/time-slots/:id', async (req, res) => {
  const { startTime, endTime, capacity, isActive } = req.body;
  const slot = await prisma.timeSlot.update({
    where: { id: Number(req.params.id) },
    data: {
      ...(startTime && { startTime }),
      ...(endTime && { endTime }),
      ...(capacity !== undefined && { capacity: Number(capacity) }),
      ...(typeof isActive === 'boolean' && { isActive })
    }
  });
  res.json(slot);
});

app.delete('/api/admin/time-slots/:id', async (req, res) => {
  await prisma.timeSlot.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

const isTimeSlotStarted = (startTime: string, bookingDate: string): boolean => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (bookingDate < today) return true;
  if (bookingDate > today) return false;

  const [hours, minutes] = startTime.split(':').map(Number);
  const slotStart = new Date(now);
  slotStart.setHours(hours, minutes, 0, 0);
  return now >= slotStart;
};

app.get('/api/time-slots/available', async (req, res) => {
  const dateStr = req.query.date as string;
  if (!dateStr) return res.status(400).json({ error: 'Date is required' });

  const targetDate = parseDateOnly(dateStr);
  if (!targetDate) return res.status(400).json({ error: 'Invalid date' });

  const slots = await prisma.timeSlot.findMany({ where: { isActive: true }, orderBy: { startTime: 'asc' } });

  const counts = await prisma.queue.groupBy({
    by: ['timeSlotId'],
    where: {
      bookingDate: targetDate,
      status: { notIn: ['CANCELLED'] },
      timeSlotId: { not: null },
    },
    _count: { _all: true },
  });

  const countMap: Record<number, number> = counts.reduce((acc: Record<number, number>, curr) => {
    if (curr.timeSlotId) acc[curr.timeSlotId] = curr._count._all;
    return acc;
  }, {});

  const result = slots.map(slot => {
    const booked = countMap[slot.id] || 0;
    return {
      ...slot,
      booked,
      available: Math.max(0, slot.capacity - booked),
      isFull: booked >= slot.capacity,
      isDisabled: isTimeSlotStarted(slot.startTime, dateStr),
    };
  });

  res.json(result);
});

// ---------------------------------------------------------------------------
// Routes: Queues (User side)

// ---------------------------------------------------------------------------
app.post('/api/queues', async (req, res) => {
  try {
    const {
      serviceId,
      contactSubject,
      contactSubjectEn,
      language,
      userName,
      userPhone,
      userEmail,
      bookingDate,
      timeSlotId,
      queueType,
    } = req.body;

    if (!contactSubject || !userName || !userPhone || !userEmail) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }

    if (!serviceId) {
      return res.status(400).json({ error: 'กรุณาเลือกประเภทบริการ' });
    }

    const service = await prisma.service.findUnique({ where: { id: Number(serviceId) } });
    if (!service) return res.status(404).json({ error: 'ไม่พบประเภทบริการนี้' });

    const subject = await prisma.contactSubject.findFirst({
      where: { name: String(contactSubject).trim(), serviceId: service.id, isActive: true },
    });
    if (!subject) return res.status(400).json({ error: 'ไม่พบเรื่องที่มาติดต่อในประเภทบริการที่เลือก' });

    const resolvedType = queueType === QueueType.BOOKING ? QueueType.BOOKING : QueueType.WALK_IN;
    const targetDate = resolvedType === QueueType.BOOKING && bookingDate ? parseDateOnly(bookingDate) : new Date();
    if (!targetDate) return res.status(400).json({ error: 'Invalid date' });
    if (resolvedType === QueueType.BOOKING) {
      if (!bookingDate || !timeSlotId) {
        return res.status(400).json({ error: 'กรุณาเลือกวันที่และช่วงเวลา' });
      }
      const slot = await prisma.timeSlot.findUnique({ where: { id: Number(timeSlotId) } });
      if (!slot || !slot.isActive) return res.status(400).json({ error: 'ช่วงเวลานี้ถูกปิดรับจอง' });
      if (isTimeSlotStarted(slot.startTime, bookingDate)) {
        return res.status(400).json({ error: 'ช่วงเวลานี้เริ่มให้บริการแล้ว ไม่สามารถจองได้' });
      }
      const bookedCount = await prisma.queue.count({
        where: { bookingDate: targetDate, timeSlotId: slot.id, status: { not: 'CANCELLED' } },
      });
      if (bookedCount >= slot.capacity) {
        return res.status(400).json({ error: 'คิวในช่วงเวลานี้เต็มแล้ว' });
      }
    } else {
      targetDate.setHours(0, 0, 0, 0);
    }

    const ticketNo = await generateTicketNo(service.id, service.prefix, targetDate);

    const queue = await prisma.queue.create({
      data: {
        ticketNo,
        serviceId: service.id,
        userName,
        userPhone,
        userEmail,
        contactSubject,
        contactSubjectEn: contactSubjectEn || null,
        language: language === 'EN' ? 'EN' : 'TH',
        queueType: resolvedType,
        status: QueueStatus.WAITING,
        isCheckedIn: resolvedType === QueueType.WALK_IN,
        checkedInAt: resolvedType === QueueType.WALK_IN ? new Date() : null,
        bookingDate: resolvedType === QueueType.BOOKING ? targetDate : targetDate,
        timeSlotId: resolvedType === QueueType.BOOKING ? Number(timeSlotId) : null,
      },
    });

    const trackUrl = `${resolveFrontendBaseUrl(req)}/track/${queue.id}`;
    const qrDataUrl = await QRCode.toDataURL(trackUrl);

    // Email delivery is best-effort and must not delay the successful booking response.
    void sendMail(
      userEmail,
      language === 'EN' ? `Queue booking confirmation: ${ticketNo}` : `ยืนยันการจองคิว: ${ticketNo}`,
      language === 'EN'
        ? `<p>Dear ${userName},</p><p>Your queue for <b>${service.nameEn || service.name}</b> has been booked.</p><p>Your queue number is <b style="font-size:20px">${ticketNo}</b></p><p>Track your queue here: <a href="${trackUrl}">${trackUrl}</a></p><p><img src="${qrDataUrl}" alt="QR Code" width="160" height="160" /></p>`
        : `<p>เรียน ${userName}</p><p>ท่านได้จองคิวสำหรับบริการ <b>${service.name}</b> เรียบร้อยแล้ว</p><p>หมายเลขคิวของท่านคือ <b style="font-size:20px">${ticketNo}</b></p><p>ติดตามสถานะคิวแบบเรียลไทม์ได้ที่: <a href="${trackUrl}">${trackUrl}</a></p><p><img src="${qrDataUrl}" alt="QR Code" width="160" height="160" /></p>`
    );

    await broadcastServiceState(service.id);
    io.emit('queue:new', queue);

    res.status(201).json({ ...queue, trackUrl, qrDataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการจองคิว' });
  }
});

// สถานะคิว + จำนวนคิวที่รอก่อนหน้า (สำหรับหน้าติดตามคิวแบบ Realtime)
app.get('/api/queues/:id', async (req, res) => {
  await expireOverdueBookings();
  const id = Number(req.params.id);
  const queue = await prisma.queue.findUnique({ where: { id }, include: { service: true, timeSlot: true } });
  if (!queue) return res.status(404).json({ error: 'ไม่พบคิวนี้' });

  // คำนวณ waitingAhead ตาม priority จริง
  // ดึง WAITING queues ทั้งหมดของ service วันนี้ที่พร้อมให้บริการ
  const now = new Date();
  const allWaiting = await prisma.queue.findMany({
    where: {
      serviceId: queue.serviceId,
      status: QueueStatus.WAITING,
      ...combineFilters(readyQueueFilter, queueDateFilter()),
    },
    include: { timeSlot: true },
  });

  // แยก: Booking ที่ slot เริ่มแล้ว vs ที่เหลือ
  const readyBookings = allWaiting.filter(
    (q) => q.queueType === QueueType.BOOKING && q.bookingDate && q.timeSlot?.startTime
      && isSlotStarted(new Date(q.bookingDate), q.timeSlot.startTime, now)
  );
  readyBookings.sort((a, b) => {
    const aSlot = a.timeSlot?.startTime ?? '99:99';
    const bSlot = b.timeSlot?.startTime ?? '99:99';
    if (aSlot !== bSlot) return aSlot.localeCompare(bSlot);
    return (a.checkedInAt?.getTime() ?? a.id) - (b.checkedInAt?.getTime() ?? b.id);
  });

  const walkIns = allWaiting.filter((q) => q.queueType === QueueType.WALK_IN);
  walkIns.sort((a, b) => a.id - b.id);

  // Booking ที่ยังไม่ถึงรอบ (checked-in แต่ slot ยังไม่เริ่ม)
  const pendingBookings = allWaiting.filter(
    (q) => q.queueType === QueueType.BOOKING && q.bookingDate && q.timeSlot?.startTime
      && !isSlotStarted(new Date(q.bookingDate), q.timeSlot.startTime, now)
  );
  pendingBookings.sort((a, b) => {
    const aSlot = a.timeSlot?.startTime ?? '99:99';
    const bSlot = b.timeSlot?.startTime ?? '99:99';
    if (aSlot !== bSlot) return aSlot.localeCompare(bSlot);
    return (a.checkedInAt?.getTime() ?? a.id) - (b.checkedInAt?.getTime() ?? b.id);
  });

  // ลำดับรวม: readyBookings → walkIns → pendingBookings
  const priorityList = [...readyBookings, ...walkIns, ...pendingBookings];
  const myIndex = priorityList.findIndex((q) => q.id === queue.id);
  const waitingAhead = myIndex >= 0 ? myIndex : 0;

  res.json({ ...queue, waitingAhead });
});

app.post('/api/queues/:id/check-in', async (req, res) => {
  await expireOverdueBookings();
  const id = Number(req.params.id);
  const queue = await prisma.queue.findUnique({ where: { id }, include: { timeSlot: true } });
  if (!queue) return res.status(404).json({ error: 'ไม่พบคิวนี้' });

  if (queue.queueType !== QueueType.BOOKING) {
    const updated = await prisma.queue.update({
      where: { id },
      data: { isCheckedIn: true, checkedInAt: new Date() },
      include: { service: true, timeSlot: true },
    });
    await broadcastServiceState(updated.serviceId);
    return res.json(updated);
  }

  if (!queue.bookingDate || !queue.timeSlot) {
    return res.status(400).json({ error: 'คิวนี้ไม่มีข้อมูลช่วงเวลา' });
  }

  const now = new Date();
  const [endHours, endMinutes] = (queue.timeSlot.endTime || '00:00').split(':').map(Number);
  const rawBookingDate = String(queue.bookingDate);
  const localBookingDate = /^\d{4}-\d{2}-\d{2}$/.test(rawBookingDate) ? `${rawBookingDate}T00:00:00` : rawBookingDate;
  const slotEnd = new Date(localBookingDate);
  slotEnd.setHours(endHours || 0, endMinutes || 0, 0, 0);
  if ((queue as typeof queue & { bookingExpired?: boolean }).bookingExpired || queue.status === QueueStatus.SKIPPED || now > slotEnd) {
    return res.status(409).json({
      code: 'BOOKING_EXPIRED',
      error: 'Booking เลยเวลาจองแล้ว กรุณาแจ้งเจ้าหน้าที่เพื่อดึงคิวกลับก่อน Check-in',
    });
  }

  const slotStart = new Date(localBookingDate);
  const [hours, minutes] = (queue.timeSlot.startTime || '00:00').split(':').map(Number);
  slotStart.setHours(hours, minutes, 0, 0);
  const canCheckIn = now >= new Date(slotStart.getTime() - 15 * 60 * 1000);

  if (!canCheckIn && !queue.isCheckedIn) {
    return res.status(400).json({ error: 'ยังไม่ถึงเวลาชำระเช็กอิน กรุณารอให้ถึง 15 นาทีก่อนเวลาเริ่ม' });
  }

  const updated = await prisma.queue.update({
    where: { id },
    data: { isCheckedIn: true, checkedInAt: queue.checkedInAt ?? now, bookingExpired: false },
    include: { service: true, timeSlot: true },
  });

  await broadcastServiceState(updated.serviceId);
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Routes: Admin / Counter controls
// ---------------------------------------------------------------------------
app.get('/api/admin/queues', async (req, res) => {
  await expireOverdueBookings();
  const serviceId = req.query.serviceId ? Number(req.query.serviceId) : undefined;
  const queues = await prisma.queue.findMany({
    where: {
      ...(serviceId ? { serviceId } : {}),
      ...combineFilters(adminQueueFilter, queueDateFilter()),
    },
    orderBy: { id: 'asc' },
    include: { service: true, timeSlot: true },
  });

  // แยก WAITING ออกมา sort ตาม priority แล้วรวมกลับกับ statuses อื่น
  const waitingQueues = queues.filter((q) => q.status === QueueStatus.WAITING);
  const otherQueues = queues.filter((q) => q.status !== QueueStatus.WAITING);
  res.json([...sortByPriority(waitingQueues), ...otherQueues]);
});


app.get('/api/admin/bookings', async (req, res) => {
  await expireOverdueBookings();
  const date = req.query.date ? String(req.query.date) : '';
  const bookingDate = date ? parseDateOnly(date) : null;
  if (date && !bookingDate) return res.status(400).json({ error: 'Invalid date' });
  const serviceId = req.query.serviceId ? Number(req.query.serviceId) : undefined;
  const bookings = await prisma.queue.findMany({
    where: {
      queueType: QueueType.BOOKING,
      ...(bookingDate ? { bookingDate } : {}),
      ...(serviceId ? { serviceId } : {}),
    },
    orderBy: [{ bookingDate: 'asc' }, { timeSlotId: 'asc' }, { createdAt: 'asc' }],
    include: { service: true, timeSlot: true },
  });
  res.json(bookings);
});

app.get('/api/admin/dashboard', async (_req, res) => {
  await expireOverdueBookings();
  const services = await prisma.service.findMany({ orderBy: { id: 'asc' } });
  const summary = await Promise.all(
    services.map(async (service) => {
      const [waiting, calling, skipped, total, typeCounts] = await Promise.all([
        prisma.queue.count({
          where: { serviceId: service.id, status: QueueStatus.WAITING, ...combineFilters(readyQueueFilter, serviceDayFilter()) },
        }),
        prisma.queue.count({
          where: { serviceId: service.id, status: QueueStatus.CALLING, ...combineFilters(readyQueueFilter, serviceDayFilter()) },
        }),
        prisma.queue.count({
          where: { serviceId: service.id, status: QueueStatus.SKIPPED, ...serviceDayFilter() },
        }),
        prisma.queue.count({
          where: { serviceId: service.id, ...serviceDayFilter() },
        }),
        prisma.queue.groupBy({
          by: ['queueType'],
          where: { serviceId: service.id, ...serviceDayFilter() },
          _count: { _all: true },
        }),
      ]);

      const walkIn = typeCounts.find((item) => item.queueType === QueueType.WALK_IN)?._count._all || 0;
      const booking = typeCounts.find((item) => item.queueType === QueueType.BOOKING)?._count._all || 0;

      return {
        id: service.id,
        name: service.name,
        prefix: service.prefix,
        waiting,
        calling,
        skipped,
        total,
        walkIn,
        booking,
      };
    })
  );

  res.json(summary);
});

app.get('/api/admin/reports', async (req, res) => {
  await expireOverdueBookings();
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const serviceId = req.query.serviceId ? Number(req.query.serviceId) : undefined;
  const queues = await prisma.queue.findMany({
    where: {
      ...(serviceId ? { serviceId } : {}),
      OR: [
        { queueType: QueueType.BOOKING, bookingDate: { gte: start, lt: end } },
        { queueType: { not: QueueType.BOOKING }, createdAt: { gte: start, lt: end } },
      ],
    },
    include: { service: true },
    orderBy: { createdAt: 'asc' },
  });

  res.json(queues.map((queue) => {
    const waitStart = queue.queueType === QueueType.BOOKING ? queue.checkedInAt : queue.createdAt;
    const waitStartTime = waitStart ? new Date(waitStart).getTime() : Date.now();
    const serviceStartTime = queue.serviceStartedAt ? new Date(queue.serviceStartedAt).getTime() : null;
    const finishTime = queue.completedAt ? new Date(queue.completedAt).getTime() : Date.now();
    const waitingSeconds = serviceStartTime
      ? Math.max(0, Math.round((serviceStartTime - waitStartTime) / 1000))
      : Math.max(0, Math.round((finishTime - waitStartTime) / 1000));
    const serviceSeconds = serviceStartTime
      ? Math.max(0, Math.round((finishTime - serviceStartTime) / 1000))
      : 0;

    return {
      ...queue,
      waitingSeconds,
      serviceSeconds,
      totalSeconds: waitingSeconds + serviceSeconds,
    };
  }));
});

// "เรียกคิวถัดไป (Next)" - ใช้ priority rule: Booking ที่ถึงรอบก่อน, จากนั้น Walk-in
app.patch('/api/admin/queues/next', async (req, res) => {
  const { serviceId, serviceIds, counterNo, servedBy } = req.body;
  const parsedCounterNo = Number(counterNo);

  if (!Number.isFinite(parsedCounterNo) || parsedCounterNo <= 0) {
    return res.status(400).json({ error: 'หมายเลขช่องบริการไม่ถูกต้อง' });
  }

  const selectedServiceIds = Array.isArray(serviceIds)
    ? serviceIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : serviceId !== undefined && serviceId !== null && serviceId !== ''
      ? [Number(serviceId)]
      : [];

  const currentQueue = await prisma.queue.findFirst({
    where: {
      status: QueueStatus.CALLING,
      counterNo: parsedCounterNo,
      ...queueDateFilter(),
    },
  });

  if (currentQueue) {
    return res.status(409).json({ error: 'ช่องบริการนี้กำลังให้บริการคิวอยู่' });
  }

  await expireOverdueBookings();
  const next = await pickNextQueue(selectedServiceIds);

  if (!next) return res.status(404).json({ error: 'ไม่มีคิวที่รออยู่' });


  const updated = await prisma.queue.update({
    where: { id: next.id },
    data: { status: QueueStatus.CALLING, counterNo: parsedCounterNo, servedBy: String(servedBy || '').trim() || null, serviceStartedAt: new Date() },
  });

  emitQueueCalled(updated); // ให้จอ Display เล่นเสียงเรียกคิว
  await broadcastServiceState(updated.serviceId);
  await checkAndNotifyUpcoming(updated.serviceId, resolveFrontendBaseUrl(req));
  res.json(updated);
});

// "เรียกคิวที่เลือก" - เรียกคิว WAITING โดยไม่ต้องเรียงตามลำดับคิว
app.patch('/api/admin/queues/:id/call', async (req, res) => {
  const id = Number(req.params.id);
  const parsedCounterNo = Number(req.body?.counterNo);
  const servedBy = String(req.body?.servedBy || '').trim() || null;

  if (!Number.isFinite(parsedCounterNo) || parsedCounterNo <= 0) {
    return res.status(400).json({ error: 'หมายเลขช่องบริการไม่ถูกต้อง' });
  }

  const [queue, currentQueue] = await Promise.all([
    prisma.queue.findUnique({ where: { id } }),
    prisma.queue.findFirst({
      where: {
        status: QueueStatus.CALLING,
        counterNo: parsedCounterNo,
        ...queueDateFilter(),
      },
    }),
  ]);

  if (!queue || queue.status !== QueueStatus.WAITING || !isQueueForToday(queue)
    || (queue.queueType === QueueType.BOOKING && !queue.isCheckedIn)) {
    return res.status(404).json({ error: 'ไม่พบคิวที่รออยู่' });
  }

  if (currentQueue) {
    return res.status(409).json({ error: 'ช่องบริการนี้กำลังให้บริการคิวอยู่' });
  }

  const updated = await prisma.queue.update({
    where: { id },
    data: { status: QueueStatus.CALLING, counterNo: parsedCounterNo, servedBy, serviceStartedAt: new Date() },
  });

  emitQueueCalled(updated);
  await broadcastServiceState(updated.serviceId);
  await checkAndNotifyUpcoming(updated.serviceId, resolveFrontendBaseUrl(req));
  res.json(updated);
});

// "เรียกซ้ำ (Recall)"
app.patch('/api/admin/queues/:id/recall', async (req, res) => {
  const id = Number(req.params.id);
  const servedBy = String(req.body?.servedBy || '').trim();
  const queue = await prisma.queue.update({
    where: { id },
    data: { status: QueueStatus.CALLING, ...(servedBy ? { servedBy } : {}), serviceStartedAt: new Date() },
  });
  emitQueueCalled(queue);
  await broadcastServiceState(queue.serviceId);
  res.json(queue);
});

// "ทำรายการเสร็จสิ้น (Complete)"
app.patch('/api/admin/queues/:id/complete', async (req, res) => {
  const id = Number(req.params.id);
  const queue = await prisma.queue.update({ where: { id }, data: { status: QueueStatus.COMPLETED, completedAt: new Date() } });
  await broadcastServiceState(queue.serviceId);
  await checkAndNotifyUpcoming(queue.serviceId, resolveFrontendBaseUrl(req));
  res.json(queue);
});

// "ข้ามคิว (Skip)"
app.patch('/api/admin/queues/:id/skip', async (req, res) => {
  const id = Number(req.params.id);
  const queue = await prisma.queue.update({ where: { id }, data: { status: QueueStatus.SKIPPED } });
  io.emit('queue:skipped', queue);
  await broadcastServiceState(queue.serviceId);
  res.json(queue);
});

// "ดึงคิวย้อนหลัง (Re-call/Re-insert)" - นำคิวที่ถูกข้ามกลับไปเป็น WAITING ลำดับถัดไป
app.patch('/api/admin/queues/:id/reinsert', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.queue.findUnique({ where: { id }, include: { timeSlot: true } });
  if (!existing || ![QueueStatus.SKIPPED, QueueStatus.CANCELLED].includes(existing.status as typeof QueueStatus.SKIPPED | typeof QueueStatus.CANCELLED)) {
    return res.status(400).json({ error: 'คิวนี้ไม่สามารถดึงกลับได้' });
  }

  // ถ้าคิวนี้เป็น Booking ที่หมดอายุ (bookingExpired=true หรือเลยเวลา slot แล้ว)
  // ให้ set isCheckedIn=true เพื่อป้องกัน expireOverdueBookings() ยกเลิกซ้ำอีกครั้ง
  // (expireOverdueBookings ข้ามคิวที่ isCheckedIn=true อยู่แล้ว)
  const slotEnd = slotEndDate({ bookingDate: existing.bookingDate, timeSlot: existing.timeSlot });
  const isExpiredBooking =
    existing.queueType === QueueType.BOOKING &&
    (existing.bookingExpired || (slotEnd != null && new Date() > slotEnd));

  const updateData: Parameters<typeof prisma.queue.update>[0]['data'] = {
    status: QueueStatus.WAITING,
    bookingExpired: false,
  };
  if (isExpiredBooking) {
    updateData.isCheckedIn = true;
    updateData.checkedInAt = existing.checkedInAt ?? new Date();
  }

  const queue = await prisma.queue.update({
    where: { id },
    data: updateData,
  });
  io.emit('queue:reinserted', queue);
  // แจ้ง TicketPage ของคิวนี้โดยตรง เพื่ออัปเดตสถานะแบบ real-time
  io.to(`queue:${queue.id}`).emit('queue:updated', queue);
  await broadcastServiceState(queue.serviceId);
  res.json(queue);
});

app.patch('/api/admin/queues/:id/cancel', async (req, res) => {
  const id = Number(req.params.id);
  const queue = await prisma.queue.update({
    where: { id },
    data: { status: QueueStatus.CANCELLED },
    include: { service: true, timeSlot: true },
  });
  await broadcastServiceState(queue.serviceId);
  io.emit('dashboard:update');
  res.json(queue);
});

// รายการคิวที่ถูกข้าม (สำหรับแถบ Skipped Queues)
app.get('/api/admin/queues/skipped', async (req, res) => {
  const serviceId = req.query.serviceId ? Number(req.query.serviceId) : undefined;
  const skipped = await prisma.queue.findMany({
    where: {
      status: QueueStatus.SKIPPED,
      ...(serviceId ? { serviceId } : {}),
      ...queueDateFilter(),
    },
    orderBy: { id: 'asc' },
    include: { service: true },
  });
  res.json(skipped);
});

// ---------------------------------------------------------------------------
// Routes: Display monitor (จอ TV)
// ---------------------------------------------------------------------------
app.get('/api/display', async (_req, res) => {
  const counters = await prisma.counter.findMany({
    where: { isActive: true },
    include: { service: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  const calling = await prisma.queue.findMany({
    where: { status: QueueStatus.CALLING, ...combineFilters(readyQueueFilter, queueDateFilter()) },
    include: { service: true },
    orderBy: { id: 'asc' },
  });
  const waitingRaw = await prisma.queue.findMany({
    where: { status: QueueStatus.WAITING, ...combineFilters(readyQueueFilter, queueDateFilter()) },
    include: { service: true, timeSlot: true },
    orderBy: { id: 'asc' },
  });
  // เรียงตาม priority: Booking ถึงรอบก่อน → Walk-in
  const waiting = sortByPriority(waitingRaw);

  const skipped = await prisma.queue.findMany({
    where: { status: QueueStatus.SKIPPED, ...queueDateFilter() },
    include: { service: true },
    orderBy: { id: 'asc' },
  });
  const displayCounters = counters.map((counter) => {
    const counterNumber = Number(counter.name.match(/\d+/)?.[0]) || counter.id;
    return {
      ...counter,
      counterNumber,
      currentQueue: calling.find((queue) => Number(queue.counterNo) === counterNumber),
      // waiting ของแต่ละ counter ก็ใช้ priority-sorted waiting list
      waiting: counter.serviceId ? waiting.filter((queue) => queue.serviceId === counter.serviceId).slice(0, 10) : [],
    };
  });
  res.json({ counters: displayCounters, calling, waiting, skipped });
});


// ---------------------------------------------------------------------------
// Routes: Announcements
// ---------------------------------------------------------------------------
// Admin CRUD
app.get('/api/admin/announcements', async (_req, res) => {
  const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(announcements);
});

app.post('/api/admin/announcements', async (req, res) => {
  const { title, body, isActive, startDate, endDate } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'กรุณาระบุหัวข้อและรายละเอียดประกาศ' });
  const announcement = await prisma.announcement.create({
    data: {
      title,
      body,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      startDate: startDate ? parseDateOnly(startDate) : null,
      endDate: endDate ? parseDateOnly(endDate) : null,
    },
  });
  res.json(announcement);
});

app.put('/api/admin/announcements/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { title, body, isActive, startDate, endDate } = req.body;
  const announcement = await prisma.announcement.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(body !== undefined && { body }),
      ...(typeof isActive === 'boolean' && { isActive }),
      ...(startDate !== undefined && { startDate: startDate ? parseDateOnly(startDate) : null }),
      ...(endDate !== undefined && { endDate: endDate ? parseDateOnly(endDate) : null }),
    },
  });
  res.json(announcement);
});

app.delete('/api/admin/announcements/:id', async (req, res) => {
  const id = Number(req.params.id);
  await prisma.announcement.delete({ where: { id } });
  res.json({ ok: true });
});

// Public: ดึงประกาศที่ Active และอยู่ในช่วงวันที่
app.get('/api/announcements/active', async (req, res) => {
  const requestedDate = req.query.date ? parseDateOnly(String(req.query.date)) : startOfToday();
  if (!requestedDate) return res.status(400).json({ error: 'Invalid date' });
  const dateStart = new Date(requestedDate);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = sameDayEnd(dateStart);
  const announcements = await prisma.announcement.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: dateEnd } }] },
        { OR: [{ endDate: null }, { endDate: { gte: dateStart } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(announcements);
});

// ---------------------------------------------------------------------------
// Socket.io: ห้องแยกตาม service (สำหรับ Admin board) และแยกตามคิว (สำหรับหน้าติดตามคิว)
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('subscribe:service', (serviceId: number) => {
    socket.join(`service:${serviceId}`);
  });
  socket.on('subscribe:track', (queueId: number) => {
    socket.join(`queue:${queueId}`);
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.originalUrl });
});

server.listen(PORT, () => {
  console.log(`🚀 School Queue backend กำลังทำงานที่ port ${PORT}`);
});

setInterval(() => {
  expireOverdueBookings().catch((error) => console.error('[expireOverdueBookings]', error));
}, 30000);

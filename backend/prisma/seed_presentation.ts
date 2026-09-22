/**
 * seed_presentation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Seed ข้อมูลสำหรับ Presentation / E2E Test
 * ครอบคลุมทุก Queue Status: WAITING, CALLING, SKIPPED, COMPLETED, CANCELLED
 * รองรับทั้ง Walk-in และ Booking (with Check-in / Expired)
 *
 * วิธีรัน (รันในโฟลเดอร์ backend):
 *   npx tsx prisma/seed_presentation.ts
 *
 * ⚠️  Script นี้จะ WIPE ข้อมูลของวันนี้ทุกรายการก่อน แล้วใส่ชุดทดสอบใหม่
 *     ข้อมูลวันอื่นจะไม่ถูกแตะต้อง
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** วันนี้ 00:00:00 local */
function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** วันพรุ่งนี้ 00:00:00 local */
function tomorrow(): Date {
  const d = today();
  d.setDate(d.getDate() + 1);
  return d;
}

/** แปลง HH:MM + date → DateTime */
function toDateTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

/** ดึง ID ของ Queue ล่าสุดจาก DB (ใช้นับ ticketNo) */
async function countTodayQueues(serviceId: number): Promise<number> {
  return prisma.queue.count({
    where: { serviceId, bookingDate: today() },
  });
}

async function nextTicketNo(serviceId: number, prefix: string): Promise<string> {
  const count = await countTodayQueues(serviceId);
  return `${prefix}-${String(count + 1).padStart(3, '0')}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  เริ่ม Seed ข้อมูล Presentation...\n');

  // ══════════════════════════════════════════════
  // 1. ADMIN USERS
  // ══════════════════════════════════════════════
  console.log('👤  สร้าง Admin Users...');

  await prisma.adminUser.upsert({
    where: { username: 'admin' },
    update: { password: 'denla2026', role: 'ADMIN' },
    create: { username: 'admin', password: 'denla2026', role: 'ADMIN' },
  });

  await prisma.adminUser.upsert({
    where: { username: 'manager01' },
    update: { password: 'manager2026', role: 'MANAGER' },
    create: { username: 'manager01', password: 'manager2026', role: 'MANAGER' },
  });

  console.log('   ✅  admin (ADMIN) | manager01 (MANAGER)');

  // ══════════════════════════════════════════════
  // 2. SETTINGS
  // ══════════════════════════════════════════════
  console.log('\n⚙️   ตั้งค่าระบบ...');

  const settingsList = [
    { key: 'siteTitle',    value: 'DENLA RAMA 5 | จองคิวธุรการ' },
    { key: 'siteSubtitle', value: 'จองคิวติดต่อธุรการโรงเรียนเด่นหล้าพระราม 5' },
  ];
  for (const s of settingsList) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }
  console.log('   ✅  Settings OK');

  // ══════════════════════════════════════════════
  // 3. SERVICES
  // ══════════════════════════════════════════════
  console.log('\n🏫  สร้าง Services...');

  const svcA = await prisma.service.upsert({
    where: { prefix: 'A' },
    update: { name: 'งานทะเบียน', nameEn: 'Registration', sortOrder: 0 },
    create: { name: 'งานทะเบียน', nameEn: 'Registration', prefix: 'A', section: 'GENERAL', sortOrder: 0 },
  });

  const svcB = await prisma.service.upsert({
    where: { prefix: 'B' },
    update: { name: 'งานการเงิน', nameEn: 'Finance', sortOrder: 1 },
    create: { name: 'งานการเงิน', nameEn: 'Finance', prefix: 'B', section: 'GENERAL', sortOrder: 1 },
  });

  console.log(`   ✅  Service A: "${svcA.name}" (ID ${svcA.id})`);
  console.log(`   ✅  Service B: "${svcB.name}" (ID ${svcB.id})`);

  // ══════════════════════════════════════════════
  // 4. CONTACT SUBJECTS
  // ══════════════════════════════════════════════
  console.log('\n📋  สร้าง Contact Subjects...');

  const subjectsA = [
    { name: 'ขอเอกสาร',      nameEn: 'Document Request',    sortOrder: 0 },
    { name: 'สมัครเรียน',   nameEn: 'Enrollment',          sortOrder: 1 },
    { name: 'ย้ายชั้นเรียน', nameEn: 'Class Transfer',      sortOrder: 2 },
  ];
  const subjectsB = [
    { name: 'ชำระค่าเล่าเรียน', nameEn: 'Tuition Payment', sortOrder: 0 },
    { name: 'ขอใบเสร็จ',        nameEn: 'Receipt Request', sortOrder: 1 },
    { name: 'ขอผ่อนผัน',        nameEn: 'Payment Deferral', sortOrder: 2 },
  ];

  for (const s of subjectsA) {
    await prisma.contactSubject.upsert({
      where: { serviceId_name: { serviceId: svcA.id, name: s.name } },
      update: { nameEn: s.nameEn, isActive: true, sortOrder: s.sortOrder },
      create: { serviceId: svcA.id, ...s, isActive: true },
    });
  }
  for (const s of subjectsB) {
    await prisma.contactSubject.upsert({
      where: { serviceId_name: { serviceId: svcB.id, name: s.name } },
      update: { nameEn: s.nameEn, isActive: true, sortOrder: s.sortOrder },
      create: { serviceId: svcB.id, ...s, isActive: true },
    });
  }

  console.log(`   ✅  A: ${subjectsA.map(s => s.name).join(', ')}`);
  console.log(`   ✅  B: ${subjectsB.map(s => s.name).join(', ')}`);

  // ══════════════════════════════════════════════
  // 5. TIME SLOTS
  // ══════════════════════════════════════════════
  console.log('\n🕐  สร้าง Time Slots...');

  const slotDefs = [
    { startTime: '08:30', endTime: '09:00', capacity: 5 },
    { startTime: '09:00', endTime: '09:30', capacity: 5 },
    { startTime: '09:30', endTime: '10:00', capacity: 5 },
    { startTime: '10:00', endTime: '10:30', capacity: 5 },
    { startTime: '10:30', endTime: '11:00', capacity: 5 },
    { startTime: '13:00', endTime: '13:30', capacity: 5 },
    { startTime: '13:30', endTime: '14:00', capacity: 5 },
  ];

  const slots: Record<string, number> = {};
  for (const def of slotDefs) {
    // ค้นหา slot ที่ตรงกันก่อน แล้วค่อย upsert
    const existing = await prisma.timeSlot.findFirst({
      where: { startTime: def.startTime, endTime: def.endTime },
    });
    let slot;
    if (existing) {
      slot = await prisma.timeSlot.update({
        where: { id: existing.id },
        data: { capacity: def.capacity, isActive: true },
      });
    } else {
      slot = await prisma.timeSlot.create({ data: { ...def, isActive: true } });
    }
    slots[def.startTime] = slot.id;
    console.log(`   ✅  ${def.startTime}–${def.endTime} (ID ${slot.id})`);
  }

  // ══════════════════════════════════════════════
  // 6. COUNTERS
  // ══════════════════════════════════════════════
  console.log('\n🖥️   สร้าง Counters...');

  const counterDefs = [
    { name: 'ช่องบริการ 1', serviceId: svcA.id, sortOrder: 0 },
    { name: 'ช่องบริการ 2', serviceId: svcA.id, sortOrder: 1 },
    { name: 'ช่องบริการ 3', serviceId: svcB.id, sortOrder: 2 },
  ];

  const counterIds: number[] = [];
  for (const def of counterDefs) {
    const existing = await prisma.counter.findFirst({ where: { name: def.name } });
    let counter;
    if (existing) {
      counter = await prisma.counter.update({
        where: { id: existing.id },
        data: { serviceId: def.serviceId, isActive: true, sortOrder: def.sortOrder, currentQueueId: null },
      });
    } else {
      counter = await prisma.counter.create({ data: { ...def, isActive: true } });
    }
    counterIds.push(counter.id);
    console.log(`   ✅  "${counter.name}" → Service ${def.serviceId} (ID ${counter.id})`);
  }

  // ══════════════════════════════════════════════
  // 7. ANNOUNCEMENTS
  // ══════════════════════════════════════════════
  console.log('\n📢  สร้าง Announcements...');

  const ann = await prisma.announcement.findFirst({ where: { title: 'ยินดีต้อนรับสู่ระบบจองคิว' } });
  if (!ann) {
    await prisma.announcement.create({
      data: {
        title: 'ยินดีต้อนรับสู่ระบบจองคิว',
        body: '<p>ยินดีต้อนรับสู่ระบบจองคิวโรงเรียนเด่นหล้าพระราม 5</p><p>กรุณาจองคิวก่อนเข้ารับบริการ เพื่อลดเวลารอคอย</p><p><strong>เวลาทำการ:</strong> จันทร์–ศุกร์ 08:00–16:00 น.</p>',
        isActive: true,
        startDate: null,
        endDate: null,
      },
    });
  }
  console.log('   ✅  Announcement สร้างเรียบร้อย');

  // ══════════════════════════════════════════════
  // 8. QUEUES — ล้างข้อมูลวันนี้ก่อน
  // ══════════════════════════════════════════════
  console.log('\n🗑️   ล้างคิวของวันนี้ก่อน...');

  // ต้อง clear currentQueueId ของ counter ก่อนลบ queues
  await prisma.counter.updateMany({ data: { currentQueueId: null } });
  const deleted = await prisma.queue.deleteMany({
    where: {
      bookingDate: today(),
    },
  });
  console.log(`   ✅  ลบ ${deleted.count} คิวของวันนี้`);

  // ══════════════════════════════════════════════
  // 9. สร้างคิวครบทุก Status
  // ══════════════════════════════════════════════
  console.log('\n🎟️   สร้างคิว Test ครบทุก Status...\n');

  const now = new Date();
  const todayDate = today();

  // ────────────────────────────────────────────
  // A-001 → WAITING (Walk-in) ✅ รอเรียกอยู่
  // ────────────────────────────────────────────
  const q1 = await prisma.queue.create({
    data: {
      ticketNo:       'A-001',
      serviceId:      svcA.id,
      userName:       'นางสาวมาลี ดีใจ',
      userPhone:      '0812345001',
      userEmail:      'mali001@denla.test',
      contactSubject: 'ขอเอกสาร',
      contactSubjectEn: 'Document Request',
      language:       'TH',
      queueType:      'WALK_IN',
      status:         'WAITING',
      isCheckedIn:    true,
      checkedInAt:    new Date(now.getTime() - 25 * 60 * 1000), // 25 นาทีที่แล้ว
      bookingDate:    todayDate,
      bookingExpired: false,
      createdAt:      new Date(now.getTime() - 25 * 60 * 1000),
    },
  });
  console.log(`   🟡  A-001 | WAITING   | Walk-in  | ${q1.userName} (ID ${q1.id})`);

  // ────────────────────────────────────────────
  // A-002 → CALLING (Walk-in) 📣 กำลังเรียก
  // ────────────────────────────────────────────
  const q2 = await prisma.queue.create({
    data: {
      ticketNo:        'A-002',
      serviceId:       svcA.id,
      userName:        'นายสมชาย ใจดี',
      userPhone:       '0812345002',
      userEmail:       'somchai002@denla.test',
      contactSubject:  'สมัครเรียน',
      contactSubjectEn: 'Enrollment',
      language:        'TH',
      queueType:       'WALK_IN',
      status:          'CALLING',
      counterNo:       1,
      servedBy:        'admin',
      isCheckedIn:     true,
      checkedInAt:     new Date(now.getTime() - 30 * 60 * 1000),
      bookingDate:     todayDate,
      serviceStartedAt: new Date(now.getTime() - 5 * 60 * 1000), // เริ่มเรียก 5 นาทีที่แล้ว
      bookingExpired:  false,
      createdAt:       new Date(now.getTime() - 30 * 60 * 1000),
    },
  });
  console.log(`   🔵  A-002 | CALLING   | Walk-in  | ${q2.userName} (ID ${q2.id}) → ช่อง 1`);

  // ผูก counter ช่องบริการ 1 กับ A-002
  if (counterIds[0]) {
    await prisma.counter.update({
      where: { id: counterIds[0] },
      data: { currentQueueId: q2.id },
    });
  }

  // ────────────────────────────────────────────
  // A-003 → SKIPPED (Walk-in) ⏭️ ถูกข้าม
  // ────────────────────────────────────────────
  const q3 = await prisma.queue.create({
    data: {
      ticketNo:        'A-003',
      serviceId:       svcA.id,
      userName:        'นางวิไล รักษา',
      userPhone:       '0812345003',
      userEmail:       'wilai003@denla.test',
      contactSubject:  'ย้ายชั้นเรียน',
      contactSubjectEn: 'Class Transfer',
      language:        'TH',
      queueType:       'WALK_IN',
      status:          'SKIPPED',
      counterNo:       2,
      servedBy:        'admin',
      isCheckedIn:     true,
      checkedInAt:     new Date(now.getTime() - 40 * 60 * 1000),
      bookingDate:     todayDate,
      serviceStartedAt: new Date(now.getTime() - 20 * 60 * 1000),
      bookingExpired:  false,
      createdAt:       new Date(now.getTime() - 40 * 60 * 1000),
    },
  });
  console.log(`   ⚠️   A-003 | SKIPPED   | Walk-in  | ${q3.userName} (ID ${q3.id})`);

  // ────────────────────────────────────────────
  // A-004 → COMPLETED (Walk-in) ✅ เสร็จสิ้น
  // ────────────────────────────────────────────
  const q4 = await prisma.queue.create({
    data: {
      ticketNo:        'A-004',
      serviceId:       svcA.id,
      userName:        'นายประสิทธิ์ สุขใจ',
      userPhone:       '0812345004',
      userEmail:       'prasit004@denla.test',
      contactSubject:  'ขอเอกสาร',
      contactSubjectEn: 'Document Request',
      language:        'TH',
      queueType:       'WALK_IN',
      status:          'COMPLETED',
      counterNo:       1,
      servedBy:        'admin',
      isCheckedIn:     true,
      checkedInAt:     new Date(now.getTime() - 60 * 60 * 1000),
      bookingDate:     todayDate,
      serviceStartedAt: new Date(now.getTime() - 50 * 60 * 1000),
      completedAt:     new Date(now.getTime() - 35 * 60 * 1000),
      bookingExpired:  false,
      createdAt:       new Date(now.getTime() - 60 * 60 * 1000),
    },
  });
  console.log(`   ✅  A-004 | COMPLETED | Walk-in  | ${q4.userName} (ID ${q4.id})`);

  // ────────────────────────────────────────────
  // A-005 → CANCELLED (Walk-in) ❌ ยกเลิก
  // ────────────────────────────────────────────
  const q5 = await prisma.queue.create({
    data: {
      ticketNo:        'A-005',
      serviceId:       svcA.id,
      userName:        'นางสาวรัตนา สว่างแสง',
      userPhone:       '0812345005',
      userEmail:       'rattana005@denla.test',
      contactSubject:  'สมัครเรียน',
      contactSubjectEn: 'Enrollment',
      language:        'TH',
      queueType:       'WALK_IN',
      status:          'CANCELLED',
      isCheckedIn:     true,
      checkedInAt:     new Date(now.getTime() - 55 * 60 * 1000),
      bookingDate:     todayDate,
      bookingExpired:  false,
      createdAt:       new Date(now.getTime() - 55 * 60 * 1000),
    },
  });
  console.log(`   ❌  A-005 | CANCELLED | Walk-in  | ${q5.userName} (ID ${q5.id})`);

  // ────────────────────────────────────────────
  // A-006 → WAITING (Walk-in) 🟡 รอ (คิวที่ 2)
  // เพิ่มเพื่อให้ Admin มีคิวให้เรียกต่อ
  // ────────────────────────────────────────────
  const q6 = await prisma.queue.create({
    data: {
      ticketNo:       'A-006',
      serviceId:      svcA.id,
      userName:       'นายกิตติ มานะ',
      userPhone:      '0812345006',
      userEmail:      'kitti006@denla.test',
      contactSubject: 'ขอเอกสาร',
      contactSubjectEn: 'Document Request',
      language:       'TH',
      queueType:      'WALK_IN',
      status:         'WAITING',
      isCheckedIn:    true,
      checkedInAt:    new Date(now.getTime() - 10 * 60 * 1000),
      bookingDate:    todayDate,
      bookingExpired: false,
      createdAt:      new Date(now.getTime() - 10 * 60 * 1000),
    },
  });
  console.log(`   🟡  A-006 | WAITING   | Walk-in  | ${q6.userName} (ID ${q6.id})`);

  // ────────────────────────────────────────────
  // A-007 → WAITING (Walk-in) 🟡 รอ (คิวที่ 3)
  // ────────────────────────────────────────────
  const q7 = await prisma.queue.create({
    data: {
      ticketNo:       'A-007',
      serviceId:      svcA.id,
      userName:       'นางสาวพิมพ์ชนก แสนดี',
      userPhone:      '0812345007',
      userEmail:      'pimchanok007@denla.test',
      contactSubject: 'ย้ายชั้นเรียน',
      contactSubjectEn: 'Class Transfer',
      language:       'TH',
      queueType:      'WALK_IN',
      status:         'WAITING',
      isCheckedIn:    true,
      checkedInAt:    new Date(now.getTime() - 5 * 60 * 1000),
      bookingDate:    todayDate,
      bookingExpired: false,
      createdAt:      new Date(now.getTime() - 5 * 60 * 1000),
    },
  });
  console.log(`   🟡  A-007 | WAITING   | Walk-in  | ${q7.userName} (ID ${q7.id})`);

  // ────────────────────────────────────────────
  // B-001 → WAITING (Booking, isCheckedIn=true) 📅 Booking มาถึงแล้ว
  // ────────────────────────────────────────────
  const slot0930 = slots['09:30'];
  const q8 = await prisma.queue.create({
    data: {
      ticketNo:        'B-001',
      serviceId:       svcB.id,
      userName:        'นายชาติชาย มั่นคง',
      userPhone:       '0812345008',
      userEmail:       'chatchai008@denla.test',
      contactSubject:  'ชำระค่าเล่าเรียน',
      contactSubjectEn: 'Tuition Payment',
      language:        'TH',
      queueType:       'BOOKING',
      status:          'WAITING',
      isCheckedIn:     true,          // Check-in แล้ว → ปรากฏในคิว Admin
      checkedInAt:     new Date(now.getTime() - 8 * 60 * 1000),
      bookingDate:     todayDate,
      timeSlotId:      slot0930 ?? null,
      bookingExpired:  false,
      createdAt:       new Date(now.getTime() - 2 * 60 * 60 * 1000),
    },
  });
  console.log(`   📅  B-001 | WAITING   | Booking  | ${q8.userName} (ID ${q8.id}) [Check-in แล้ว]`);

  // ────────────────────────────────────────────
  // B-002 → WAITING (Booking, isCheckedIn=false) 📅 Booking ยังไม่ Check-in
  // ────────────────────────────────────────────
  const slot1000 = slots['10:00'];
  const q9 = await prisma.queue.create({
    data: {
      ticketNo:        'B-002',
      serviceId:       svcB.id,
      userName:        'นางสาวพิมพ์ใจ ขาวสะอาด',
      userPhone:       '0812345009',
      userEmail:       'pimjai009@denla.test',
      contactSubject:  'ขอใบเสร็จ',
      contactSubjectEn: 'Receipt Request',
      language:        'TH',
      queueType:       'BOOKING',
      status:          'WAITING',
      isCheckedIn:     false,         // ยังไม่ Check-in → ไม่ปรากฏในคิว Admin
      bookingDate:     todayDate,
      timeSlotId:      slot1000 ?? null,
      bookingExpired:  false,
      createdAt:       new Date(now.getTime() - 3 * 60 * 60 * 1000),
    },
  });
  console.log(`   📅  B-002 | WAITING   | Booking  | ${q9.userName} (ID ${q9.id}) [ยังไม่ Check-in]`);

  // ────────────────────────────────────────────
  // B-003 → CALLING (Booking) 📣 เรียกแล้ว
  // ────────────────────────────────────────────
  const q10 = await prisma.queue.create({
    data: {
      ticketNo:        'B-003',
      serviceId:       svcB.id,
      userName:        'นายสุรชาติ พงษ์ดี',
      userPhone:       '0812345010',
      userEmail:       'surachat010@denla.test',
      contactSubject:  'ชำระค่าเล่าเรียน',
      contactSubjectEn: 'Tuition Payment',
      language:        'TH',
      queueType:       'BOOKING',
      status:          'CALLING',
      counterNo:       3,
      servedBy:        'admin',
      isCheckedIn:     true,
      checkedInAt:     new Date(now.getTime() - 20 * 60 * 1000),
      bookingDate:     todayDate,
      timeSlotId:      slot0930 ?? null,
      serviceStartedAt: new Date(now.getTime() - 3 * 60 * 1000),
      bookingExpired:  false,
      createdAt:       new Date(now.getTime() - 4 * 60 * 60 * 1000),
    },
  });
  console.log(`   🔵  B-003 | CALLING   | Booking  | ${q10.userName} (ID ${q10.id}) → ช่อง 3`);

  // ผูก counter ช่องบริการ 3 กับ B-003
  if (counterIds[2]) {
    await prisma.counter.update({
      where: { id: counterIds[2] },
      data: { currentQueueId: q10.id },
    });
  }

  // ────────────────────────────────────────────
  // B-004 → COMPLETED (Booking) ✅ เสร็จสิ้น
  // ────────────────────────────────────────────
  const q11 = await prisma.queue.create({
    data: {
      ticketNo:        'B-004',
      serviceId:       svcB.id,
      userName:        'นางมณี ทองสุข',
      userPhone:       '0812345011',
      userEmail:       'manee011@denla.test',
      contactSubject:  'ขอผ่อนผัน',
      contactSubjectEn: 'Payment Deferral',
      language:        'TH',
      queueType:       'BOOKING',
      status:          'COMPLETED',
      counterNo:       3,
      servedBy:        'admin',
      isCheckedIn:     true,
      checkedInAt:     new Date(now.getTime() - 2.5 * 60 * 60 * 1000),
      bookingDate:     todayDate,
      timeSlotId:      slot0930 ?? null,
      serviceStartedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      completedAt:     new Date(now.getTime() - 1.5 * 60 * 60 * 1000),
      bookingExpired:  false,
      createdAt:       new Date(now.getTime() - 5 * 60 * 60 * 1000),
    },
  });
  console.log(`   ✅  B-004 | COMPLETED | Booking  | ${q11.userName} (ID ${q11.id})`);

  // ────────────────────────────────────────────
  // B-005 → CANCELLED (Booking, bookingExpired=true) ⏰ Expired อัตโนมัติ
  // ────────────────────────────────────────────
  const slotExpired = slots['08:30']; // Slot 08:30 เลยมาแล้ว → Expired
  const q12 = await prisma.queue.create({
    data: {
      ticketNo:        'B-005',
      serviceId:       svcB.id,
      userName:        'นายอาทิตย์ รุ่งเรือง',
      userPhone:       '0812345012',
      userEmail:       'artit012@denla.test',
      contactSubject:  'ชำระค่าเล่าเรียน',
      contactSubjectEn: 'Tuition Payment',
      language:        'TH',
      queueType:       'BOOKING',
      status:          'CANCELLED',
      isCheckedIn:     false,
      bookingDate:     todayDate,
      timeSlotId:      slotExpired ?? null,
      bookingExpired:  true,           // ถูก Auto-expire
      createdAt:       new Date(now.getTime() - 6 * 60 * 60 * 1000),
    },
  });
  console.log(`   ⏰  B-005 | CANCELLED | Booking  | ${q12.userName} (ID ${q12.id}) [bookingExpired=true]`);

  // ────────────────────────────────────────────
  // A-008 → WAITING (English, Walk-in) 🌏 ภาษาอังกฤษ
  // ────────────────────────────────────────────
  const q13 = await prisma.queue.create({
    data: {
      ticketNo:        'A-008',
      serviceId:       svcA.id,
      userName:        'Ms. Sarah Johnson',
      userPhone:       '0812345013',
      userEmail:       'sarah013@denla.test',
      contactSubject:  'ขอเอกสาร',
      contactSubjectEn: 'Document Request',
      language:        'EN',           // ภาษาอังกฤษ
      queueType:       'WALK_IN',
      status:          'WAITING',
      isCheckedIn:     true,
      checkedInAt:     new Date(now.getTime() - 3 * 60 * 1000),
      bookingDate:     todayDate,
      bookingExpired:  false,
      createdAt:       new Date(now.getTime() - 3 * 60 * 1000),
    },
  });
  console.log(`   🌏  A-008 | WAITING   | Walk-in  | ${q13.userName} (EN) (ID ${q13.id})`);

  // ────────────────────────────────────────────
  // BONUS: B-006 → WAITING (Booking, พรุ่งนี้) 📅 คิวพรุ่งนี้
  // ────────────────────────────────────────────
  const slot0900tmr = slots['09:00'];
  const q14 = await prisma.queue.create({
    data: {
      ticketNo:        'B-006',
      serviceId:       svcB.id,
      userName:        'นางสาวอรทัย สดใส',
      userPhone:       '0812345014',
      userEmail:       'oratai014@denla.test',
      contactSubject:  'ชำระค่าเล่าเรียน',
      contactSubjectEn: 'Tuition Payment',
      language:        'TH',
      queueType:       'BOOKING',
      status:          'WAITING',
      isCheckedIn:     false,
      bookingDate:     tomorrow(),     // จองสำหรับพรุ่งนี้
      timeSlotId:      slot0900tmr ?? null,
      bookingExpired:  false,
      createdAt:       new Date(now.getTime() - 1 * 60 * 60 * 1000),
    },
  });
  console.log(`   📅  B-006 | WAITING   | Booking  | ${q14.userName} (ID ${q14.id}) [พรุ่งนี้]`);

  // ══════════════════════════════════════════════
  // 10. สรุปผล
  // ══════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('📊  สรุปข้อมูลที่ Seed แล้ว:\n');

  const summary = await prisma.queue.groupBy({
    by: ['status', 'queueType'],
    _count: { _all: true },
    orderBy: [{ status: 'asc' }, { queueType: 'asc' }],
  });

  for (const row of summary) {
    const icon = row.status === 'WAITING' ? '🟡' : row.status === 'CALLING' ? '🔵' : row.status === 'SKIPPED' ? '⚠️ ' : row.status === 'COMPLETED' ? '✅' : '❌';
    console.log(`   ${icon}  ${row.status.padEnd(10)} | ${row.queueType.padEnd(8)} | ${row._count._all} คิว`);
  }

  console.log('\n📋  URL สำหรับ Track Ticket:');
  const allQueues = await prisma.queue.findMany({
    orderBy: { id: 'asc' },
    include: { service: true },
  });
  for (const q of allQueues) {
    const label = q.status.padEnd(10);
    const type  = q.queueType === 'BOOKING' ? '📅 Booking' : '🚶 Walk-in';
    console.log(`   ${q.ticketNo.padEnd(6)} (ID ${String(q.id).padEnd(3)}) | ${label} | ${type} | http://localhost:8080/track/${q.id}`);
  }

  console.log('\n👤  Admin Credentials:');
  console.log('   ADMIN   : admin / denla2026       → http://localhost:8080/admin/login');
  console.log('   MANAGER : manager01 / manager2026  → http://localhost:8080/admin/login');

  console.log('\n🎉  Seed เสร็จสมบูรณ์!');
  console.log('─'.repeat(70));
}

main()
  .catch((error) => {
    console.error('\n❌  Seed Error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

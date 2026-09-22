import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const services = [
  { name: 'Admission', prefix: 'A', section: 'Admission', icon: '💳', sortOrder: 0 },
  { name: 'Academy', prefix: 'B', section: 'Academy', icon: '📝', sortOrder: 1 },
  { name: 'Finance', prefix: 'C', section: 'Finance', icon: '📄', sortOrder: 2 },
];

const contactSubjects = [
  { servicePrefix: 'A', name: 'สมัครเรียน', nameEn: 'Enrollment' },
  { servicePrefix: 'A', name: 'ยื่นเอกสาร', nameEn: 'Document Submission' },
  { servicePrefix: 'B', name: 'สอบถามหลักสูตร', nameEn: 'Course Inquiry' },
  { servicePrefix: 'B', name: 'ติดต่อครู', nameEn: 'Teacher Contact' },
  { servicePrefix: 'C', name: 'ชำระค่าเทอม', nameEn: 'Tuition Payment' },
  { servicePrefix: 'C', name: 'ขอใบเสร็จ', nameEn: 'Receipt Request' },
];

async function main() {
  const serviceByPrefix = new Map<string, number>();

  for (const service of services) {
    const saved = await prisma.service.upsert({
      where: { prefix: service.prefix },
      update: {
        name: service.name,
        section: service.section,
        icon: service.icon,
        sortOrder: service.sortOrder,
      },
      create: service,
    });
    serviceByPrefix.set(saved.prefix, saved.id);
  }

  for (const subject of contactSubjects) {
    const serviceId = serviceByPrefix.get(subject.servicePrefix);
    if (!serviceId) continue;

    await prisma.contactSubject.upsert({
      where: { serviceId_name: { serviceId, name: subject.name } },
      update: { nameEn: subject.nameEn, isActive: true },
      create: { serviceId, name: subject.name, nameEn: subject.nameEn, isActive: true },
    });
  }

  console.log(`Seeded ${services.length} services and ${contactSubjects.length} contact subjects.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

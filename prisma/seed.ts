// Creates the admin account from ADMIN_EMAIL and ADMIN_PASSWORD in .env.
// Run with: npm run seed:admin
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getPasswordHash } from '../src/utils/security';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Never promote or change an existing account: anyone can register with
    // the admin email before the seed runs, and would then become admin.
    if (existing.role !== 'admin') {
      throw new Error(
        `${email} is already registered as a normal user. Choose another ADMIN_EMAIL, ` +
          'or check who created that account before promoting it by hand.'
      );
    }
    console.log(`Admin ${email} already exists; nothing to do.`);
    return;
  }

  await prisma.user.create({
    data: {
      name: 'Admin',
      email,
      passwordHash: await getPasswordHash(password),
      role: 'admin',
      provider: 'local',
    },
  });
  console.log(`Created admin ${email}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

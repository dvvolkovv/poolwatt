import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const username = process.argv[2];
if (!username) {
  console.error("usage: grant-admin <username>");
  process.exit(1);
}

(async () => {
  await prisma.user.update({ where: { username }, data: { role: "ADMIN" } });
  console.log(`granted ADMIN to ${username}`);
  await prisma.$disconnect();
})();

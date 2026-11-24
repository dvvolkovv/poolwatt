-- Accounts created through Taler ID have no password.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- One linked identity per provider per user.
CREATE UNIQUE INDEX "Account_userId_provider_key" ON "Account"("userId", "provider");

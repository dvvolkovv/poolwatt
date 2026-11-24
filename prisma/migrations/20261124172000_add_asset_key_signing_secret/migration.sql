-- AlterTable
ALTER TABLE "AssetApiKey" ADD COLUMN     "signingSecretEnc" TEXT,
ADD COLUMN     "signingSecretIv" TEXT;


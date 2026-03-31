-- CreateTable
CREATE TABLE "WebhookDeduplication" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDeduplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDeduplication_messageId_key" ON "WebhookDeduplication"("messageId");

-- CreateIndex
CREATE INDEX "WebhookDeduplication_expiresAt_idx" ON "WebhookDeduplication"("expiresAt");

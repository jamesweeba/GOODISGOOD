-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userPhone" TEXT NOT NULL,
    "activeState" TEXT,
    "statePayload" JSONB,
    "lastMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_userPhone_key" ON "UserSession"("userPhone");

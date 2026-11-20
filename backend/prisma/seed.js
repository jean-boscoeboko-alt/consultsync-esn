const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Identifiants déterministes pour garantir l'idempotence des upserts
const SEED_IDS = {
  MISSION_FINANCEDATA: '11111111-1111-4111-8111-111111111111',
  EXPENSE_MEAL: '22222222-2222-4222-8222-222222222221',
  EXPENSE_TRANSPORT: '22222222-2222-4222-8222-222222222222',
  ABSENCE_CP: '33333333-3333-4333-8333-333333333331',
};

async function main() {
  console.log('Démarrage de l’initialisation des données (seed) ConsultSync...');

  // ==========================================
  // 1. UTILISATEURS (ADMIN & CONSULTANT)
  // ==========================================
  const adminPasswordHash = await bcrypt.hash('Admin123!', 10);
  const consultantPasswordHash = await bcrypt.hash('Consult123!', 10);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@consultsync.fr' },
    update: {
      password: adminPasswordHash,
      firstName: 'Camille',
      lastName: 'Dupont',
      jobTitle: 'Directrice des Opérations & RH',
      role: 'ADMIN',
      isActive: true,
    },
    create: {
      email: 'admin@consultsync.fr',
      password: adminPasswordHash,
      firstName: 'Camille',
      lastName: 'Dupont',
      jobTitle: 'Directrice des Opérations & RH',
      role: 'ADMIN',
      cpBalance: 25.0,
      rttBalance: 10.0,
      isActive: true,
    },
  });

  const thomasUser = await prisma.user.upsert({
    where: { email: 'thomas.laurent@consultsync.fr' },
    update: {
      password: consultantPasswordHash,
      firstName: 'Thomas',
      lastName: 'Laurent',
      jobTitle: 'Consultant Full-Stack Senior',
      role: 'CONSULTANT',
      cpBalance: 14.5,
      rttBalance: 6.0,
      isActive: true,
    },
    create: {
      email: 'thomas.laurent@consultsync.fr',
      password: consultantPasswordHash,
      firstName: 'Thomas',
      lastName: 'Laurent',
      jobTitle: 'Consultant Full-Stack Senior',
      role: 'CONSULTANT',
      cpBalance: 14.5,
      rttBalance: 6.0,
      isActive: true,
    },
  });

  console.log(`Utilisateurs créés/mis à jour : ${adminUser.email} (${adminUser.role}), ${thomasUser.email} (${thomasUser.role})`);

  // ==========================================
  // 2. MISSION ACTIVE "FINANCEDATA"
  // ==========================================
  const financeDataMission = await prisma.mission.upsert({
    where: { id: SEED_IDS.MISSION_FINANCEDATA },
    update: {
      clientName: 'FinanceData',
      title: 'Architecte Cloud & Full-Stack Senior',
      description: 'Architecture applicative et développement de la plateforme de pilotage financier.',
      tjm: 680.0,
      startDate: new Date('2026-01-05T00:00:00.000Z'),
      endDate: null,
      status: 'ACTIVE',
      consultantId: thomasUser.id,
    },
    create: {
      id: SEED_IDS.MISSION_FINANCEDATA,
      clientName: 'FinanceData',
      title: 'Architecte Cloud & Full-Stack Senior',
      description: 'Architecture applicative et développement de la plateforme de pilotage financier.',
      tjm: 680.0,
      startDate: new Date('2026-01-05T00:00:00.000Z'),
      endDate: null,
      status: 'ACTIVE',
      consultantId: thomasUser.id,
    },
  });

  console.log(`Mission créée/mise à jour : ${financeDataMission.clientName} (TJM : ${financeDataMission.tjm} €)`);

  // ==========================================
  // 3. ENTRÉES DE CRA (NOVEMBRE 2026)
  // ==========================================
  const sampleCraEntries = [
    {
      date: new Date('2026-11-02T00:00:00.000Z'),
      dayType: 'WORKED',
      duration: 1.0,
      status: 'DRAFT',
      comment: 'Cadrage architecture cloud FinanceData',
    },
    {
      date: new Date('2026-11-03T00:00:00.000Z'),
      dayType: 'WORKED',
      duration: 1.0,
      status: 'DRAFT',
      comment: 'Développement API & intégration PostgreSQL',
    },
    {
      date: new Date('2026-11-04T00:00:00.000Z'),
      dayType: 'WORKED',
      duration: 1.0,
      status: 'DRAFT',
      comment: 'Développement API & tests',
    },
    {
      date: new Date('2026-11-05T00:00:00.000Z'),
      dayType: 'ON_CALL',
      duration: 1.0,
      status: 'DRAFT',
      comment: 'Astreinte mise en production',
    },
    {
      date: new Date('2026-11-06T00:00:00.000Z'),
      dayType: 'LEAVE',
      duration: 1.0,
      status: 'DRAFT',
      comment: 'Journée de RTT posée',
    },
  ];

  for (const entry of sampleCraEntries) {
    await prisma.craEntry.upsert({
      where: {
        userId_date: {
          userId: thomasUser.id,
          date: entry.date,
        },
      },
      update: {
        dayType: entry.dayType,
        duration: entry.duration,
        status: entry.status,
        comment: entry.comment,
        missionId: financeDataMission.id,
      },
      create: {
        userId: thomasUser.id,
        missionId: financeDataMission.id,
        date: entry.date,
        dayType: entry.dayType,
        duration: entry.duration,
        status: entry.status,
        comment: entry.comment,
      },
    });
  }

  console.log(`${sampleCraEntries.length} entrées de CRA créées/mises à jour pour Thomas Laurent.`);

  // ==========================================
  // 4. NOTES DE FRAIS (2 EXEMPLES)
  // ==========================================
  const expenseMeal = await prisma.expense.upsert({
    where: { id: SEED_IDS.EXPENSE_MEAL },
    update: {
      title: 'Déjeuner Client FinanceData',
      amount: 42.0,
      category: 'MEAL',
      expenseDate: new Date('2026-11-12T12:00:00.000Z'),
      receiptUrl: 'justificatif_dejeuner_financedata.pdf',
      status: 'APPROVED',
      rejectionReason: null,
      userId: thomasUser.id,
      missionId: financeDataMission.id,
    },
    create: {
      id: SEED_IDS.EXPENSE_MEAL,
      title: 'Déjeuner Client FinanceData',
      amount: 42.0,
      category: 'MEAL',
      expenseDate: new Date('2026-11-12T12:00:00.000Z'),
      receiptUrl: 'justificatif_dejeuner_financedata.pdf',
      status: 'APPROVED',
      userId: thomasUser.id,
      missionId: financeDataMission.id,
    },
  });

  const expenseTransport = await prisma.expense.upsert({
    where: { id: SEED_IDS.EXPENSE_TRANSPORT },
    update: {
      title: 'Abonnement Pass Navigo',
      amount: 86.4,
      category: 'TRANSPORT',
      expenseDate: new Date('2026-11-18T09:00:00.000Z'),
      receiptUrl: 'attestation_navigo_nov2026.pdf',
      status: 'PENDING',
      rejectionReason: null,
      userId: thomasUser.id,
      missionId: financeDataMission.id,
    },
    create: {
      id: SEED_IDS.EXPENSE_TRANSPORT,
      title: 'Abonnement Pass Navigo',
      amount: 86.4,
      category: 'TRANSPORT',
      expenseDate: new Date('2026-11-18T09:00:00.000Z'),
      receiptUrl: 'attestation_navigo_nov2026.pdf',
      status: 'PENDING',
      userId: thomasUser.id,
      missionId: financeDataMission.id,
    },
  });

  console.log(`2 notes de frais créées/mises à jour : "${expenseMeal.title}" (${expenseMeal.status}), "${expenseTransport.title}" (${expenseTransport.status})`);

  // ==========================================
  // 5. DEMANDE D'ABSENCE DE TEST
  // ==========================================
  const sampleAbsence = await prisma.absence.upsert({
    where: { id: SEED_IDS.ABSENCE_CP },
    update: {
      type: 'CP',
      startDate: new Date('2026-12-24T00:00:00.000Z'),
      endDate: new Date('2026-12-28T00:00:00.000Z'),
      daysCount: 3.0,
      justificationUrl: null,
      comment: 'Congés payés de fin d’année',
      status: 'PENDING',
      rejectionReason: null,
      userId: thomasUser.id,
    },
    create: {
      id: SEED_IDS.ABSENCE_CP,
      type: 'CP',
      startDate: new Date('2026-12-24T00:00:00.000Z'),
      endDate: new Date('2026-12-28T00:00:00.000Z'),
      daysCount: 3.0,
      justificationUrl: null,
      comment: 'Congés payés de fin d’année',
      status: 'PENDING',
      userId: thomasUser.id,
    },
  });

  console.log(`1 demande d'absence créée/mise à jour : ${sampleAbsence.type} (${sampleAbsence.daysCount} jours, statut ${sampleAbsence.status})`);
  console.log('Seed terminé avec succès.');
}

main()
  .catch((error) => {
    console.error('Erreur lors de l’exécution du seed Prisma :', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

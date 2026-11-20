require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

if (!JWT_SECRET) {
  console.error('ERREUR FATALE : La variable d’environnement JWT_SECRET est manquante.');
  process.exit(1);
}

// ==========================================
// MIDDLEWARES GLOBAUX
// ==========================================

app.use(
  cors({
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

// ==========================================
// MIDDLEWARES D'AUTHENTIFICATION & RBAC
// ==========================================

/**
 * Vérifie la présence et la validité du token JWT dans l'en-tête Authorization.
 * Format attendu : "Bearer <token>"
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Accès refusé. Jeton d’authentification manquant.',
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) {
      return res.status(403).json({
        error: 'Jeton invalide ou expiré.',
      });
    }

    req.user = decodedUser;
    next();
  });
}

/**
 * Middleware optionnel de restriction par rôle (ex: authorizeRoles('ADMIN'))
 */
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Permissions insuffisantes pour accéder à cette ressource.',
      });
    }
    next();
  };
}

/**
 * Middleware dédié à l'espace Administration / Direction (Lot 3)
 * Vérifie strictement que req.user.role === 'ADMIN'
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({
      error: 'Accès réservé aux administrateurs et managers (rôle ADMIN requis).',
    });
  }
  next();
}

// ==========================================
// HELPERS DE VALIDATION & NORMALISATION
// ==========================================

const CRA_DAY_TYPE_MAP = {
  WORKED: 'WORKED',
  worked: 'WORKED',
  TRAVAILLE: 'WORKED',
  LEAVE: 'LEAVE',
  leave: 'LEAVE',
  CONGE: 'LEAVE',
  ON_CALL: 'ON_CALL',
  oncall: 'ON_CALL',
  ASTREINTE: 'ON_CALL',
};

const EXPENSE_CATEGORY_MAP = {
  TRANSPORT: 'TRANSPORT',
  Transport: 'TRANSPORT',
  MEAL: 'MEAL',
  Repas: 'MEAL',
  ACCOMMODATION: 'ACCOMMODATION',
  Hébergement: 'ACCOMMODATION',
  Hebergement: 'ACCOMMODATION',
  EQUIPMENT_OTHER: 'EQUIPMENT_OTHER',
  'Matériel / Divers': 'EQUIPMENT_OTHER',
  'Materiel / Divers': 'EQUIPMENT_OTHER',
};

const ABSENCE_TYPE_MAP = {
  CP: 'CP',
  'Congés Payés (CP)': 'CP',
  'Conges Payes (CP)': 'CP',
  RTT: 'RTT',
  SICK_LEAVE: 'SICK_LEAVE',
  'Arrêt Maladie': 'SICK_LEAVE',
  'Arret Maladie': 'SICK_LEAVE',
  FAMILY_EVENT: 'FAMILY_EVENT',
  'Événement familial': 'FAMILY_EVENT',
  'Evenement familial': 'FAMILY_EVENT',
  UNPAID: 'UNPAID',
  'Congé sans solde': 'UNPAID',
};

/**
 * Retourne le mois courant au format "YYYY-MM" (UTC)
 */
function getCurrentYearMonth() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Retourne les bornes [startDate, endDate[ UTC pour un mois "YYYY-MM"
 */
function getMonthDateRange(monthStr) {
  const [year, monthNum] = monthStr.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, monthNum - 1, 1));
  const endDate = new Date(Date.UTC(year, monthNum, 1));
  return { startDate, endDate };
}

/**
 * Convertit une chaîne "YYYY-MM-DD" en Date UTC à 00:00:00.000
 */
function parseUtcDateOnly(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/**
 * Calcule le nombre de jours ouvrés (lundi à vendredi) entre deux dates UTC incluses
 */
function calculateBusinessDays(startDate, endDate) {
  let count = 0;
  const current = new Date(startDate.getTime());
  while (current <= endDate) {
    const dayOfWeek = current.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count += 1;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count > 0 ? count : 1;
}

// ==========================================
// ROUTES PUBLIQUES
// ==========================================

// Vérification de l'état du serveur
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'ConsultSync API',
    timestamp: new Date().toISOString(),
  });
});

// Authentification utilisateur
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Les champs email et password sont obligatoires.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Identifiants invalides.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        error: 'Ce compte utilisateur est désactivé. Contactez un administrateur.',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'Identifiants invalides.',
      });
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    return res.status(200).json({
      message: 'Authentification réussie.',
      token,
      role: user.role,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        name: `${user.firstName} ${user.lastName}`,
        jobTitle: user.jobTitle,
        role: user.role,
        cpBalance: user.cpBalance,
        rttBalance: user.rttBalance,
      },
    });
  } catch (error) {
    console.error('Erreur lors de la connexion (/api/auth/login) :', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur lors de l’authentification.',
    });
  }
});

// ==========================================
// ROUTES PROTÉGÉES — PROFIL UTILISATEUR
// ==========================================

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        role: true,
        cpBalance: true,
        rttBalance: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    return res.status(200).json({
      user: {
        ...user,
        name: `${user.firstName} ${user.lastName}`,
      },
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du profil (/api/auth/me) :', error);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

// ==========================================
// ROUTES PROTÉGÉES (LOT 2) — CRA / STAFFING
// ==========================================

/**
 * GET /api/cra?month=YYYY-MM
 * Récupère les entrées CRA de l'utilisateur connecté pour le mois demandé
 */
app.get('/api/cra', authenticateToken, async (req, res) => {
  try {
    const { month } = req.query;

    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        error: 'Le paramètre de requête "month" est obligatoire au format YYYY-MM (ex: 2026-11).',
      });
    }

    const { startDate, endDate } = getMonthDateRange(month);

    const entries = await prisma.craEntry.findMany({
      where: {
        userId: req.user.userId,
        date: {
          gte: startDate,
          lt: endDate,
        },
      },
      include: {
        mission: {
          select: {
            id: true,
            clientName: true,
            title: true,
          },
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    const summary = entries.reduce(
      (acc, entry) => {
        if (entry.dayType === 'WORKED') acc.workedDays += entry.duration;
        if (entry.dayType === 'LEAVE') acc.leaveDays += entry.duration;
        if (entry.dayType === 'ON_CALL') acc.onCallDays += entry.duration;
        return acc;
      },
      { workedDays: 0, leaveDays: 0, onCallDays: 0 }
    );

    return res.status(200).json({
      month,
      summary,
      entries,
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du CRA (GET /api/cra) :', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur lors de la récupération du CRA.',
    });
  }
});

/**
 * POST /api/cra
 * Enregistre ou met à jour les jours déclarés (travaillé, congé, astreinte) pour le mois
 */
app.post('/api/cra', authenticateToken, async (req, res) => {
  try {
    const { month, entries, submit = false, missionId } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        error: 'Le champ "entries" doit être un tableau non vide de déclarations journalières.',
      });
    }

    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        error: 'Le format du champ "month" doit être YYYY-MM.',
      });
    }

    let resolvedMissionId = missionId || null;
    if (!resolvedMissionId) {
      const activeMission = await prisma.mission.findFirst({
        where: {
          consultantId: req.user.userId,
          status: 'ACTIVE',
        },
        orderBy: { startDate: 'desc' },
      });
      if (activeMission) {
        resolvedMissionId = activeMission.id;
      }
    }

    const targetStatus = submit ? 'SUBMITTED' : 'DRAFT';
    const normalizedEntries = [];

    for (const item of entries) {
      const parsedDate = parseUtcDateOnly(item.date);
      if (!parsedDate) {
        return res.status(400).json({
          error: `Date invalide détectée : "${item.date}". Format attendu : YYYY-MM-DD.`,
        });
      }

      if (month && !item.date.startsWith(month)) {
        return res.status(400).json({
          error: `La date "${item.date}" ne correspond pas au mois sélectionné (${month}).`,
        });
      }

      const normalizedDayType = CRA_DAY_TYPE_MAP[item.dayType];
      if (!normalizedDayType) {
        return res.status(400).json({
          error: `Type de journée invalide "${item.dayType}". Valeurs autorisées : WORKED, LEAVE, ON_CALL.`,
        });
      }

      const duration = item.duration !== undefined ? Number(item.duration) : 1.0;
      if (Number.isNaN(duration) || duration <= 0 || duration > 1) {
        return res.status(400).json({
          error: `Durée invalide pour le ${item.date}. La valeur doit être comprise entre 0.5 et 1.0.`,
        });
      }

      normalizedEntries.push({
        date: parsedDate,
        dayType: normalizedDayType,
        duration,
        comment: item.comment ? String(item.comment).trim() : null,
        missionId: item.missionId || resolvedMissionId,
      });
    }

    const existingApproved = await prisma.craEntry.findFirst({
      where: {
        userId: req.user.userId,
        date: { in: normalizedEntries.map((e) => e.date) },
        status: 'APPROVED',
      },
    });

    if (existingApproved) {
      return res.status(409).json({
        error: 'Certaines journées de ce CRA ont déjà été validées par un administrateur et ne peuvent plus être modifiées.',
      });
    }

    const savedEntries = await prisma.$transaction(
      normalizedEntries.map((entry) =>
        prisma.craEntry.upsert({
          where: {
            userId_date: {
              userId: req.user.userId,
              date: entry.date,
            },
          },
          update: {
            dayType: entry.dayType,
            duration: entry.duration,
            status: targetStatus,
            comment: entry.comment,
            missionId: entry.missionId,
          },
          create: {
            userId: req.user.userId,
            date: entry.date,
            dayType: entry.dayType,
            duration: entry.duration,
            status: targetStatus,
            comment: entry.comment,
            missionId: entry.missionId,
          },
        })
      )
    );

    return res.status(200).json({
      message: submit
        ? 'CRA mensuel transmis pour validation avec succès.'
        : 'Brouillon du CRA enregistré avec succès.',
      status: targetStatus,
      count: savedEntries.length,
      entries: savedEntries,
    });
  } catch (error) {
    console.error('Erreur lors de l’enregistrement du CRA (POST /api/cra) :', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur lors de la sauvegarde du CRA.',
    });
  }
});

// ==========================================
// ROUTES PROTÉGÉES (LOT 2) — NOTES DE FRAIS
// ==========================================

/**
 * GET /api/expenses
 * Liste les notes de frais de l'utilisateur connecté
 */
app.get('/api/expenses', authenticateToken, async (req, res) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: {
        userId: req.user.userId,
      },
      include: {
        mission: {
          select: {
            id: true,
            clientName: true,
            title: true,
          },
        },
      },
      orderBy: [
        { expenseDate: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return res.status(200).json({
      expenses,
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des frais (GET /api/expenses) :', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur lors de la récupération des notes de frais.',
    });
  }
});

/**
 * POST /api/expenses
 * Crée une nouvelle note de frais pour l'utilisateur connecté
 */
app.post('/api/expenses', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      amount,
      category,
      receiptUrl,
      receiptName,
      expenseDate,
      missionId,
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        error: 'L’intitulé (title) de la note de frais est obligatoire.',
      });
    }

    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        error: 'Le montant (amount) doit être un nombre strictement positif.',
      });
    }

    const normalizedCategory = EXPENSE_CATEGORY_MAP[category];
    if (!normalizedCategory) {
      return res.status(400).json({
        error:
          'Catégorie invalide. Valeurs acceptées : TRANSPORT, MEAL, ACCOMMODATION, EQUIPMENT_OTHER.',
      });
    }

    let parsedExpenseDate = new Date();
    if (expenseDate) {
      const candidate = new Date(expenseDate);
      if (Number.isNaN(candidate.getTime())) {
        return res.status(400).json({
          error: 'Format de date invalide pour "expenseDate".',
        });
      }
      parsedExpenseDate = candidate;
    }

    let resolvedMissionId = missionId || null;
    if (!resolvedMissionId) {
      const activeMission = await prisma.mission.findFirst({
        where: {
          consultantId: req.user.userId,
          status: 'ACTIVE',
        },
        orderBy: { startDate: 'desc' },
      });
      if (activeMission) {
        resolvedMissionId = activeMission.id;
      }
    }

    const finalReceiptUrl = receiptUrl || receiptName || null;

    const expense = await prisma.expense.create({
      data: {
        title: String(title).trim(),
        amount: numericAmount,
        category: normalizedCategory,
        expenseDate: parsedExpenseDate,
        receiptUrl: finalReceiptUrl ? String(finalReceiptUrl).trim() : null,
        status: 'PENDING',
        userId: req.user.userId,
        missionId: resolvedMissionId,
      },
      include: {
        mission: {
          select: {
            id: true,
            clientName: true,
            title: true,
          },
        },
      },
    });

    return res.status(201).json({
      message: 'Note de frais enregistrée et soumise pour validation.',
      expense,
    });
  } catch (error) {
    console.error('Erreur lors de la création de la note de frais (POST /api/expenses) :', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur lors de la création de la note de frais.',
    });
  }
});

// ==========================================
// ROUTES PROTÉGÉES (LOT 2) — ABSENCES & CONGÉS
// ==========================================

/**
 * GET /api/absences
 * Récupère l'historique des demandes d'absence et les soldes CP/RTT
 */
app.get('/api/absences', authenticateToken, async (req, res) => {
  try {
    const [user, absences] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user.userId },
        select: {
          cpBalance: true,
          rttBalance: true,
        },
      }),
      prisma.absence.findMany({
        where: {
          userId: req.user.userId,
        },
        orderBy: [
          { startDate: 'desc' },
          { createdAt: 'desc' },
        ],
      }),
    ]);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    return res.status(200).json({
      balances: {
        cpBalance: user.cpBalance,
        rttBalance: user.rttBalance,
      },
      absences,
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des absences (GET /api/absences) :', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur lors de la récupération des absences.',
    });
  }
});

/**
 * POST /api/absences
 * Soumet une nouvelle demande d'absence
 */
app.post('/api/absences', authenticateToken, async (req, res) => {
  try {
    const {
      type,
      startDate,
      endDate,
      daysCount,
      justificationUrl,
      justificationName,
      comment,
    } = req.body;

    const normalizedType = ABSENCE_TYPE_MAP[type];
    if (!normalizedType) {
      return res.status(400).json({
        error:
          'Type d’absence invalide. Valeurs acceptées : CP, RTT, SICK_LEAVE, FAMILY_EVENT, UNPAID.',
      });
    }

    if (!startDate) {
      return res.status(400).json({
        error: 'La date de début (startDate) est obligatoire.',
      });
    }

    const parsedStartDate = new Date(startDate);
    if (Number.isNaN(parsedStartDate.getTime())) {
      return res.status(400).json({
        error: 'Format de date invalide pour "startDate".',
      });
    }

    const parsedEndDate = endDate ? new Date(endDate) : new Date(parsedStartDate.getTime());
    if (Number.isNaN(parsedEndDate.getTime())) {
      return res.status(400).json({
        error: 'Format de date invalide pour "endDate".',
      });
    }

    if (parsedEndDate < parsedStartDate) {
      return res.status(400).json({
        error: 'La date de fin (endDate) ne peut pas être antérieure à la date de début.',
      });
    }

    const calculatedDays =
      daysCount !== undefined
        ? Number(daysCount)
        : calculateBusinessDays(parsedStartDate, parsedEndDate);

    if (Number.isNaN(calculatedDays) || calculatedDays <= 0) {
      return res.status(400).json({
        error: 'Le nombre de jours (daysCount) doit être supérieur à 0.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { cpBalance: true, rttBalance: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    if (normalizedType === 'CP' && calculatedDays > user.cpBalance) {
      return res.status(400).json({
        error: `Solde CP insuffisant (${user.cpBalance} j disponibles pour ${calculatedDays} j demandés).`,
      });
    }

    if (normalizedType === 'RTT' && calculatedDays > user.rttBalance) {
      return res.status(400).json({
        error: `Solde RTT insuffisant (${user.rttBalance} j disponibles pour ${calculatedDays} j demandés).`,
      });
    }

    const finalJustificationUrl = justificationUrl || justificationName || null;

    const absence = await prisma.absence.create({
      data: {
        type: normalizedType,
        startDate: parsedStartDate,
        endDate: parsedEndDate,
        daysCount: calculatedDays,
        justificationUrl: finalJustificationUrl ? String(finalJustificationUrl).trim() : null,
        comment: comment ? String(comment).trim() : null,
        status: 'PENDING',
        userId: req.user.userId,
      },
    });

    return res.status(201).json({
      message: 'Demande d’absence enregistrée et transmise pour validation.',
      balances: {
        cpBalance: user.cpBalance,
        rttBalance: user.rttBalance,
      },
      absence,
    });
  } catch (error) {
    console.error('Erreur lors de la création de l’absence (POST /api/absences) :', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur lors de la création de la demande d’absence.',
    });
  }
});

// ==========================================
// ROUTES PROTÉGÉES (LOT 3) — ADMINISTRATION
// ==========================================

/**
 * GET /api/admin/kpis?month=YYYY-MM
 * Calcule et renvoie les indicateurs globaux de l'ESN :
 * - Chiffre d'Affaires du mois (€)
 * - TJM moyen (€)
 * - TACE global (%)
 * - Nombre de validations en attente (frais + absences)
 */
app.get('/api/admin/kpis', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const targetMonth = req.query.month || getCurrentYearMonth();

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) {
      return res.status(400).json({
        error: 'Le paramètre "month" doit être au format YYYY-MM (ex: 2026-11).',
      });
    }

    const { startDate, endDate } = getMonthDateRange(targetMonth);

    const [
      monthlyCraEntries,
      activeMissions,
      pendingExpensesCount,
      pendingAbsencesCount,
    ] = await Promise.all([
      prisma.craEntry.findMany({
        where: {
          date: {
            gte: startDate,
            lt: endDate,
          },
        },
        include: {
          mission: {
            select: {
              tjm: true,
            },
          },
        },
      }),
      prisma.mission.findMany({
        where: {
          status: 'ACTIVE',
        },
        select: {
          id: true,
          tjm: true,
        },
      }),
      prisma.expense.count({
        where: { status: 'PENDING' },
      }),
      prisma.absence.count({
        where: { status: 'PENDING' },
      }),
    ]);

    // 1. Calcul du Chiffre d'Affaires du mois et des volumes de jours
    let monthlyRevenue = 0;
    let workedDays = 0;
    let onCallDays = 0;
    let leaveDays = 0;

    for (const entry of monthlyCraEntries) {
      if (entry.dayType === 'WORKED') {
        workedDays += entry.duration;
        const missionTjm = entry.mission ? entry.mission.tjm : 0;
        monthlyRevenue += entry.duration * missionTjm;
      } else if (entry.dayType === 'ON_CALL') {
        onCallDays += entry.duration;
      } else if (entry.dayType === 'LEAVE') {
        leaveDays += entry.duration;
      }
    }

    // 2. Calcul du TJM moyen sur les missions actives
    const averageTjm =
      activeMissions.length > 0
        ? Number(
            (
              activeMissions.reduce((sum, m) => sum + m.tjm, 0) /
              activeMissions.length
            ).toFixed(2)
          )
        : 0;

    // 3. Calcul du TACE global (Taux d'Activité Congés Exclus = WORKED / (WORKED + ON_CALL))
    const availableDaysExcludingLeave = workedDays + onCallDays;
    const tace =
      availableDaysExcludingLeave > 0
        ? Number(((workedDays / availableDaysExcludingLeave) * 100).toFixed(1))
        : 0;

    // 4. Nombre total de validations en attente
    const pendingValidations = pendingExpensesCount + pendingAbsencesCount;

    return res.status(200).json({
      month: targetMonth,
      kpis: {
        monthlyRevenue: Number(monthlyRevenue.toFixed(2)),
        averageTjm,
        tace,
        pendingValidations,
        activeMissionsCount: activeMissions.length,
        pendingExpensesCount,
        pendingAbsencesCount,
        breakdown: {
          workedDays,
          onCallDays,
          leaveDays,
        },
      },
    });
  } catch (error) {
    console.error('Erreur lors du calcul des KPIs (GET /api/admin/kpis) :', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur lors du calcul des indicateurs.',
    });
  }
});

/**
 * GET /api/admin/validations
 * Liste toutes les notes de frais et demandes d'absences au statut PENDING avec le nom du consultant
 */
app.get('/api/admin/validations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [pendingExpenses, pendingAbsences] = await Promise.all([
      prisma.expense.findMany({
        where: { status: 'PENDING' },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              jobTitle: true,
            },
          },
          mission: {
            select: {
              id: true,
              clientName: true,
              title: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.absence.findMany({
        where: { status: 'PENDING' },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              jobTitle: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const formattedExpenses = pendingExpenses.map((exp) => ({
      id: exp.id,
      type: 'expense',
      consultantId: exp.user.id,
      consultantName: `${exp.user.firstName} ${exp.user.lastName}`,
      consultantEmail: exp.user.email,
      title: exp.title,
      category: exp.category,
      amount: exp.amount,
      expenseDate: exp.expenseDate,
      receiptUrl: exp.receiptUrl,
      mission: exp.mission,
      status: exp.status,
      createdAt: exp.createdAt,
    }));

    const formattedAbsences = pendingAbsences.map((abs) => ({
      id: abs.id,
      type: 'absence',
      consultantId: abs.user.id,
      consultantName: `${abs.user.firstName} ${abs.user.lastName}`,
      consultantEmail: abs.user.email,
      absenceType: abs.type,
      startDate: abs.startDate,
      endDate: abs.endDate,
      daysCount: abs.daysCount,
      justificationUrl: abs.justificationUrl,
      comment: abs.comment,
      status: abs.status,
      createdAt: abs.createdAt,
    }));

    const validations = [...formattedExpenses, ...formattedAbsences].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    return res.status(200).json({
      totalPending: validations.length,
      validations,
      expenses: formattedExpenses,
      absences: formattedAbsences,
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des validations (GET /api/admin/validations) :', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur lors de la récupération des demandes en attente.',
    });
  }
});

/**
 * PATCH /api/admin/validations/:type/:id
 * Approuve (APPROVED) ou rejette (REJECTED) une note de frais (expense) ou une absence (absence)
 */
app.patch('/api/admin/validations/:type/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { status, rejectionReason } = req.body;

    if (!['expense', 'absence'].includes(type)) {
      return res.status(400).json({
        error: 'Type de validation invalide. Valeurs attendues : "expense" ou "absence".',
      });
    }

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({
        error: 'Statut invalide. Valeurs attendues : "APPROVED" ou "REJECTED".',
      });
    }

    const sanitizedReason =
      status === 'REJECTED' && rejectionReason
        ? String(rejectionReason).trim()
        : null;

    if (type === 'expense') {
      const existingExpense = await prisma.expense.findUnique({
        where: { id },
        include: {
          user: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
      });

      if (!existingExpense) {
        return res.status(404).json({
          error: 'Note de frais introuvable.',
        });
      }

      if (existingExpense.status !== 'PENDING') {
        return res.status(400).json({
          error: `Cette note de frais a déjà été traitée (statut actuel : ${existingExpense.status}).`,
        });
      }

      const updatedExpense = await prisma.expense.update({
        where: { id },
        data: {
          status,
          rejectionReason: sanitizedReason,
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      return res.status(200).json({
        message:
          status === 'APPROVED'
            ? 'Note de frais approuvée avec succès.'
            : 'Note de frais rejetée.',
        type: 'expense',
        item: updatedExpense,
      });
    }

    // Traitement d'une absence ('absence') avec mise à jour atomique du solde CP / RTT si approuvée
    const existingAbsence = await prisma.absence.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            cpBalance: true,
            rttBalance: true,
          },
        },
      },
    });

    if (!existingAbsence) {
      return res.status(404).json({
        error: 'Demande d’absence introuvable.',
      });
    }

    if (existingAbsence.status !== 'PENDING') {
      return res.status(400).json({
        error: `Cette demande d’absence a déjà été traitée (statut actuel : ${existingAbsence.status}).`,
      });
    }

    const updatedAbsence = await prisma.$transaction(async (tx) => {
      const absenceRecord = await tx.absence.update({
        where: { id },
        data: {
          status,
          rejectionReason: sanitizedReason,
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      if (status === 'APPROVED') {
        if (existingAbsence.type === 'CP') {
          const newCpBalance = Math.max(
            0,
            Number((existingAbsence.user.cpBalance - existingAbsence.daysCount).toFixed(2))
          );
          await tx.user.update({
            where: { id: existingAbsence.userId },
            data: { cpBalance: newCpBalance },
          });
        } else if (existingAbsence.type === 'RTT') {
          const newRttBalance = Math.max(
            0,
            Number((existingAbsence.user.rttBalance - existingAbsence.daysCount).toFixed(2))
          );
          await tx.user.update({
            where: { id: existingAbsence.userId },
            data: { rttBalance: newRttBalance },
          });
        }
      }

      return absenceRecord;
    });

    return res.status(200).json({
      message:
        status === 'APPROVED'
          ? 'Demande d’absence approuvée et solde mis à jour.'
          : 'Demande d’absence rejetée.',
      type: 'absence',
      item: updatedAbsence,
    });
  } catch (error) {
    console.error('Erreur lors de la validation (PATCH /api/admin/validations/:type/:id) :', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur lors de la mise à jour de la validation.',
    });
  }
});

/**
 * POST /api/admin/reminders
 * Enregistre / simule l'envoi des relances e-mail pour les consultants
 * n'ayant pas encore soumis ou validé leur CRA du mois
 */
app.post('/api/admin/reminders', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const targetMonth = req.body.month || getCurrentYearMonth();
    const { consultantIds } = req.body;

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) {
      return res.status(400).json({
        error: 'Le champ "month" doit être au format YYYY-MM (ex: 2026-11).',
      });
    }

    const { startDate, endDate } = getMonthDateRange(targetMonth);

    // Recherche des consultants actifs (hors ADMIN) et de leurs entrées CRA déjà soumises/approuvées
    const consultants = await prisma.user.findMany({
      where: {
        role: 'CONSULTANT',
        isActive: true,
        ...(Array.isArray(consultantIds) && consultantIds.length > 0
          ? { id: { in: consultantIds } }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        craEntries: {
          where: {
            date: {
              gte: startDate,
              lt: endDate,
            },
            status: {
              in: ['SUBMITTED', 'APPROVED'],
            },
          },
          select: {
            id: true,
          },
        },
      },
    });

    // Consultants n'ayant aucune journée soumise ou validée pour le mois ciblé
    const lateConsultants = consultants.filter(
      (consultant) => consultant.craEntries.length === 0
    );

    const workspaceBaseUrl = process.env.CLIENT_URL || 'http://localhost:5500';
    const sentAt = new Date().toISOString();

    const reminders = lateConsultants.map((consultant) => {
      const fullName = `${consultant.firstName} ${consultant.lastName}`;
      const directLink = `${workspaceBaseUrl}/?view=consultant&tab=cra&month=${targetMonth}`;

      return {
        consultantId: consultant.id,
        consultantName: fullName,
        email: consultant.email,
        month: targetMonth,
        status: 'SENT_SIMULATED',
        sentAt,
        emailPreview: {
          to: consultant.email,
          subject: `[Action requise] Saisie de votre CRA — ${targetMonth}`,
          body: `Bonjour ${fullName}, sauf erreur de notre part, votre staffing pour la période de ${targetMonth} n'a pas encore été validé. Merci de le compléter dès aujourd'hui via votre espace : ${directLink}`,
        },
      };
    });

    if (reminders.length > 0) {
      console.log(
        `[ConsultSync Mailer] ${reminders.length} relance(s) CRA simulée(s) pour ${targetMonth} par admin ${req.user.email}`
      );
    }

    return res.status(200).json({
      message:
        reminders.length > 0
          ? `${reminders.length} e-mail(s) de relance CRA envoyé(s) avec succès.`
          : 'Tous les consultants actifs ont déjà soumis leur CRA pour cette période.',
      month: targetMonth,
      sentCount: reminders.length,
      sentAt,
      reminders,
    });
  } catch (error) {
    console.error('Erreur lors de l’envoi des relances (POST /api/admin/reminders) :', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur lors de l’envoi des relances CRA.',
    });
  }
});

// ==========================================
// GESTION DES ROUTES INCONNUES & DÉMARRAGE
// ==========================================

app.use((req, res) => {
  res.status(404).json({ error: 'Route API introuvable.' });
});

const server = app.listen(PORT, () => {
  console.log(`Serveur ConsultSync API démarré sur http://localhost:${PORT}`);
});

// Arrêt propre de Prisma à la fermeture du processus
const gracefulShutdown = async () => {
  console.log('\nFermeture du serveur ConsultSync API...');
  await prisma.$disconnect();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = { app, authenticateToken, authorizeRoles, requireAdmin };

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

// ==========================================
// HELPERS DE VALIDATION & NORMALISATION (LOT 2)
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

    const [year, monthNum] = month.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, monthNum - 1, 1));
    const endDate = new Date(Date.UTC(year, monthNum, 1));

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
 * Body attendu :
 * {
 *   "month": "2026-11", // optionnel si toutes les dates sont fournies
 *   "submit": true,       // true => status SUBMITTED, false => status DRAFT
 *   "missionId": "...",   // optionnel (utilise la mission ACTIVE par défaut si absente)
 *   "entries": [
 *     { "date": "2026-11-02", "dayType": "WORKED", "duration": 1, "comment": "..." }
 *   ]
 * }
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

    // Résolution de la mission par défaut (mission ACTIVE du consultant)
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

    // Vérifier qu'aucune entrée ciblée n'est déjà verrouillée (APPROVED)
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

    // Rattachement automatique à la mission active si missionId non fourni
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

    // Vérification des soldes CP / RTT avant soumission
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

module.exports = { app, authenticateToken, authorizeRoles };

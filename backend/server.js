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
// ROUTES PROTÉGÉES (EXEMPLE DE BASE)
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

    return res.status(200).json({ user });
  } catch (error) {
    console.error('Erreur lors de la récupération du profil (/api/auth/me) :', error);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
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

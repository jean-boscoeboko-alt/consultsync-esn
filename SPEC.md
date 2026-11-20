# Spécifications Techniques et Fonctionnelles — ConsultSync (SPEC.md)

Ce document rassemble les spécifications fonctionnelles, le référentiel technique Front-end et Back-end ainsi que le découpage en lots de la plateforme **ConsultSync** (solution ERP et de centralisation d'activité pour ESN et cabinets de conseil).

---

## 1. Liste des Fonctionnalités (Features)

### A. Vitrine Publique & Conversion (Landing Page)
* **Barre de navigation principale (Navbar) :**
  * Logo et identité visuelle (« ConsultSync »).
  * Menu d'accès rapide aux ancres : *Accueil & Fonctionnalités*, *Mon Espace Activité*, *Demander une Démo*.
  * Commutateur de rôle en temps réel (*« Switch Rôle »*) avec badge d'état dynamique (*Consultant* en bleu / *Admin* en vert).
* **Section Hero (Accueil) :**
  * Accroche principale dédiée aux ESN et cabinets de conseil.
  * Bouton d'appel à l'action (CTA) principal : *« Demander une Démo »*.
  * Statistique clé mise en avant (*« +40% de gain de temps sur la gestion administrative »*).
* **Bandeau de preuve sociale (Carousel défilant) :**
  * Barre défilante infinie affichant les logos des entreprises partenaires (*TechConsult*, *AeroSpace Corp*, *FinanceData*, *Nexus Digital*, *Global Services*).
* **Grille des fonctionnalités clés :**
  * Cartes de présentation illustrées pour la saisie du staffing, les frais, les absences et le dashboard.
* **Modale de demande de Démo :**
  * Formulaire interactif comprenant : *Nom complet*, *E-mail professionnel*, *Nom de l'entreprise*.
  * Notification de confirmation visuelle (*Toast*) à la soumission.

---

### B. Espace Collaborateur / Consultant

#### 1. Module de Saisie du Staffing / CRA (Compte Rendu d'Activité)
* **Sélecteur de période :** Menu déroulant pour le choix du mois d'activité.
* **Grille mensuelle interactive :**
  * Saisie par clic direct sur les cartes jours pour alterner entre les états : *Travaillé* (Vert), *Congé / Absence* (Rouge), *Astreinte / Intercontrat* (Orange).
* **Calculateur automatique :** Compteur dynamique du total de jours travaillés sur la période.
* **Bouton de soumission :** Action *« Valider mon CRA »* enregistrant la déclaration.

#### 2. Module de Gestion des Notes de Frais & Factures
* **Formulaire de dépôt de dépense :**
  * Champs : *Intitulé de la dépense*, *Montant (€)*, *Catégorie* (Transport, Repas, Hébergement, Matériel / Divers).
  * Zone de téléchargement de justificatifs (PDF/images) avec prévisualisation dynamique du nom de fichier.
* **Tableau de suivi historique :**
  * Récapitulatif des frais avec badges de statut colorés (*En attente*, *Approuvé*, *Rejeté*).

#### 3. Module de Demandes d'Absences & Congés
* **Indicateur de soldes :** Compteurs en temps réel des jours de CP et RTT disponibles.
* **Formulaire de demande :**
  * Champs : *Type d'absence*, *Date de début*, et téléversement du justificatif médical ou RH.

#### 4. Module d'Historique des Missions
* **Fiches synthétiques de mission :**
  * Informations sur le client, le rôle, la période et le TJM (Taux Journalier Moyen).
* **Espace documentaire rattaché :**
  * Vue extensible regroupant les factures et notes de frais associées à chaque mission avec options de téléchargement.

---

### C. Espace Administration / Management

#### 1. Dashboard Financier & Pilotage (KPIs)
* **Indicateurs financiers globaux :**
  * *Chiffre d'Affaires Mensuel* (€), *TJM Moyen*, *TACE* (Taux d'Activité Congés Exclus en %), et *Validations en attente*.
* **Graphique interactif (Chart.js) :**
  * Visualisation de la rentabilité par mission et de l'évolution du chiffre d'affaires.

#### 2. Centre de Validation (Workflow RH & Finance)
* **File d'attente des demandes :**
  * Centralisation des notes de frais et demandes de congés à valider.
* **Actions de modération immédiates :**
  * Boutons *« Approuver »* et *« Rejeter »* mettant à jour en temps réel les indicateurs du dashboard.

#### 3. Module d'Automatisation des Relances E-mail
* **Suivi des retards de staffing :**
  * Identification automatique des consultants n'ayant pas validé leur CRA à date.
* **Relance automatique :**
  * Bouton *« Relancer les CRA en retard »*.
  * Modale de prévisualisation du courriel avec variables dynamiques (*{nom_consultant}*, *{mois}*, *{lien_direct}*).

#### 4. Matrice de Gestion des Droits et Accès (RBAC)
* **Tableau des permissions :**
  * Configuration granulaire par cases à cocher pour restreindre ou accorder la visibilité des rubriques aux collaborateurs.

---

### D. Composants Transversaux
* **Système de notifications Toast :** Alertes éphémères de confirmation d'action.
* **Navigation Single Page Application (SPA) :** Permutation dynamique des vues sans rechargement de page.

---

## 2. Référentiel Technique (Back-end & Front-end)

### A. Front-end (Interface Utilisateur)
* **HTML5 Sémantique :** Balisage structuré pour l'accessibilité et la lisibilité.
* **Tailwind CSS :** Design system réactif (grid, flexbox, composabilité des styles).
* **JavaScript ES6+ :** Gestion de l'état local, routage SPA, interactions DOM et formulaires.
* **Chart.js :** Moteur de rendu graphique pour les métriques financières.
* **FontAwesome :** Icônes vectorielles pour l'interface.

### B. Back-end (Architecture Cible & Production)
* **Runtime & Framework :** Node.js avec Express.js (API RESTful).
* **Base de Données Relationnelle :** PostgreSQL.
* **ORM :** Prisma ou TypeORM.
* **Sécurité & Authentification :**
  * Authentification stateless par jetons JWT.
  * Hachage des mots de passe via Bcrypt.
  * Middlewares de contrôle d'accès basé sur les rôles (RBAC).
* **Stockage de Fichiers (Object Storage) :** AWS S3 ou Scaleway Object Storage pour les pièces jointes (frais et absences).
* **Automatisations & E-mails :**
  * Node-Cron / BullMQ pour la planification des tâches de relance.
  * Nodemailer / SendGrid pour l'envoi effectif des courriels.

---

## 3. Découpage en Lots (Feuille de Route Projet)

### Vue d'ensemble du Séquencement

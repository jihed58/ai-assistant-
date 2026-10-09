const mongoose = require('mongoose');
const ollamaService = require('../services/ollamaService');
const mistralService = require('../services/mistralService');

// Allowed ERP collections
const ALLOWED_COLLECTIONS = [
  'employe', 'departement', 'client', 'article',
  'fournisseur', 'facture', 'parcmachine', 'intervention',
];

// Friendly French labels for each ERP collection
const COLLECTION_LABELS = {
  employe: { singular: 'employé', plural: 'employés' },
  departement: { singular: 'département', plural: 'départements' },
  client: { singular: 'client', plural: 'clients' },
  article: { singular: 'article en stock', plural: 'articles en stock' },
  fournisseur: { singular: 'fournisseur', plural: 'fournisseurs' },
  facture: { singular: 'facture', plural: 'factures' },
  parcmachine: { singular: 'machine', plural: 'machines' },
  intervention: { singular: 'intervention', plural: 'interventions' },
};

/**
 * Detects the target ERP collection from natural language keywords.
 */
function detectERPCollection(text) {
  const p = (text || '').toLowerCase();
  if (/\b(client|clients)\b/i.test(p)) return 'client';
  if (/\b(article|articles|produit|produits|stock|inventaire)\b/i.test(p)) return 'article';
  if (/\b(employ[eé]|employ[eé]s|salari[eé]|salari[eé]s|personnel|equipe|staff)\b/i.test(p)) return 'employe';
  if (/\b(d[eé]partement|d[eé]partements|service|services|pole|p[oô]les)\b/i.test(p)) return 'departement';
  if (/\b(fournisseur|fournisseurs|prestataire|prestataires)\b/i.test(p)) return 'fournisseur';
  if (/\b(facture|factures)\b/i.test(p)) return 'facture';
  if (/\b(machine|machines|parcmachine|parc)\b/i.test(p)) return 'parcmachine';
  if (/\b(intervention|interventions|panne|pannes|maintenance|r[eé]paration|r[eé]parations)\b/i.test(p)) return 'intervention';
  return null;
}

/**
 * POST /api/query
 * Always accurately handles COUNT vs LIST and general inquiries.
 */
const handleQuery = async (req, res) => {
  const { prompt, provider } = req.body;

  // 1️⃣ Empty prompt check
  if (!prompt || prompt.trim() === '') {
    return res.json({
      prompt: '',
      reply: "Veuillez taper une question pour que je puisse vous renseigner sur les données de l'ERP.",
    });
  }

  const cleanPrompt = prompt.trim();
  const promptLower = cleanPrompt.toLowerCase();

  // 2️⃣ Friendly greetings check
  if (/^(bonjour|salut|coucou|hello|bonsoir|qui es-tu|qui es tu)\b/i.test(cleanPrompt)) {
    return res.json({
      prompt: cleanPrompt,
      reply: "Bonjour ! Je suis votre assistant ERP intelligent. Vous pouvez me poser des questions comme :\n• \"Combien de clients avons-nous ?\"\n• \"Donne-moi la liste des articles\"\n• \"Montre-moi les employés\"",
    });
  }

  const detectedColl = detectERPCollection(cleanPrompt);
  const isCount = /\b(combien|nombre|quantit[eé]|total|compte|how many|count)\b/i.test(promptLower);
  const isList = /\b(liste|donne|affiche|montre|quels|quelles|voir|qui sont|show|list)\b/i.test(promptLower);
  const hasSpecificCriteria = /\b(qui|dont|avec|sans|actif|inactive|panne|bloqu[eé]|code|id|en date|pour)\b/i.test(promptLower);

  // 3️⃣ Fast-path for direct COUNT or simple LIST of all items in a collection
  if (detectedColl && (isCount || isList) && !hasSpecificCriteria) {
    try {
      const db = global.erpDb || mongoose.connection.db;
      const col = db.collection(detectedColl);
      const label = COLLECTION_LABELS[detectedColl] || { singular: detectedColl, plural: `${detectedColl}s` };

      if (isCount) {
        const count = await col.countDocuments({});
        return res.json({
          prompt: cleanPrompt,
          reply: `Il y a actuellement **${count} ${label.plural}** enregistré(s) dans le système ERP.`,
        });
      }

      if (isList) {
        const docs = await col.find({}).limit(50).toArray();
        if (docs.length === 0) {
          return res.json({
            prompt: cleanPrompt,
            reply: `Aucun(e) **${label.singular}** n'a été trouvé(e) dans la base de données.`,
          });
        }
        const names = docs.map(d => ollamaService.extractDisplayName(d, detectedColl)).filter(Boolean);
        let listReply = `Voici la liste des **${label.plural}** enregistrés dans l'ERP (${docs.length} au total) :\n\n`;
        listReply += names.map(n => `• ${n}`).join('\n');
        return res.json({
          prompt: cleanPrompt,
          reply: listReply,
        });
      }
    } catch (directErr) {
      console.warn('[QueryController] Direct fast-path error, continuing to AI pipeline:', directErr.message);
    }
  }

  // 4️⃣ AI-powered pipeline for filtered queries or complex questions
  let useOffline = false;

  try {
    if (provider === 'ollama') {
      useOffline = true;
    } else if (provider === 'mistral') {
      useOffline = false;
    } else {
      useOffline = await ollamaService.isOllamaRunning();
    }
    
    const activeService = useOffline ? ollamaService : mistralService;
    const providerName = useOffline ? 'Ollama (Local Hors-Ligne)' : 'Mistral (Cloud)';
    console.log(`[QueryController] Using AI Provider: ${providerName} (requested: ${provider || 'auto'})`);

    // Analyze prompt with AI
    const queryObject = await activeService.generateMongoQuery(cleanPrompt);

    // Direct reply from AI (greetings, off-topic)
    if (queryObject.type === 'direct_reply' && queryObject.message) {
      return res.json({
        prompt: cleanPrompt,
        reply: queryObject.message,
      });
    }

    // Determine target collection
    let collectionName = queryObject.collection ? queryObject.collection.toLowerCase().trim() : detectedColl;

    if (!collectionName || !ALLOWED_COLLECTIONS.includes(collectionName)) {
      if (detectedColl) {
        collectionName = detectedColl;
      } else {
        return res.json({
          prompt: cleanPrompt,
          reply: "Je n'ai pas bien compris sur quelle partie de l'ERP porte votre question. Vous pouvez m'interroger sur les employés, clients, articles, factures, départements, fournisseurs ou machines.",
        });
      }
    }

    // Security check
    const queryStr = JSON.stringify(queryObject.query || {});
    const BLOCKED_OPERATORS = ['$where', '$expr', '$function', '$accumulator'];
    for (const op of BLOCKED_OPERATORS) {
      if (queryStr.includes(op)) {
        return res.json({
          prompt: cleanPrompt,
          reply: "Pour des raisons de sécurité, cette formulation n'est pas autorisée. Veuillez poser votre question sous une forme plus simple.",
        });
      }
    }

    // Execute query on MongoDB
    const db = global.erpDb || mongoose.connection.db;
    const collection = db.collection(collectionName);
    const limit = Math.min(queryObject.limit || 50, 100);

    let mongoQuery = queryObject.query || {};
    if (mongoQuery.$match) {
      mongoQuery = mongoQuery.$match;
    }
    if (typeof mongoQuery !== 'object' || Array.isArray(mongoQuery) || mongoQuery === null) {
      mongoQuery = {};
    }
    if (mongoQuery._id === null || mongoQuery._id === undefined) {
      delete mongoQuery._id;
    }

    let results = [];
    try {
      results = await collection.find(mongoQuery).limit(limit).toArray();
    } catch (queryErr) {
      console.warn('[QueryController] Filter error, falling back to all docs:', queryErr.message);
      results = await collection.find({}).limit(limit).toArray();
    }

    // Generate natural text response
    let reply = '';
    try {
      reply = await activeService.generateNaturalAnswer(cleanPrompt, results, collectionName);
    } catch (answerErr) {
      const label = COLLECTION_LABELS[collectionName] || { singular: collectionName, plural: `${collectionName}s` };
      if (results.length === 0) {
        reply = `Aucun(e) **${label.singular}** correspondant n'a été trouvé(e).`;
      } else {
        reply = `J'ai trouvé **${results.length} ${label.plural}** correspondant à votre demande.`;
      }
    }

    return res.json({
      prompt: cleanPrompt,
      reply,
    });

  } catch (err) {
    console.error('[QueryController] Error:', err.message || err);

    let friendlyReply = "Je n'ai pas pu récupérer cette information pour le moment. Pourriez-vous reformuler votre question plus simplement ? (ex: 'Combien de clients ?' ou 'Donne-moi la liste des articles')";

    const errMsg = (err.message || '').toLowerCase();

    if (!useOffline && (errMsg.includes('enotfound') || errMsg.includes('fetch failed') || errMsg.includes('eai_again') || errMsg.includes('network'))) {
      friendlyReply = "Vous êtes actuellement hors-ligne et le moteur IA local (Ollama) n'a pas été détecté. Pour utiliser l'assistant sans connexion Internet, assurez-vous d'avoir installé et démarré Ollama.";
    } else if (err.statusCode === 429 || (err.message && err.message.includes('429'))) {
      friendlyReply = "Le service d'intelligence artificielle reçoit actuellement beaucoup de demandes. Merci de patienter une petite minute avant de reposer votre question.";
    }

    return res.json({
      prompt: cleanPrompt,
      reply: friendlyReply,
    });
  }
};

module.exports = { handleQuery };
